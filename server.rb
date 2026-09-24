#!/usr/bin/env ruby
# Serves the app + proxies Spitcast API (browser CORS workaround).
require 'webrick'
require 'net/http'
require 'uri'
require 'json'
require 'openssl'
require 'fileutils'
require 'securerandom'
require 'base64'

ROOT = File.expand_path(__dir__)
PORT = (ENV['PORT'] || 8080).to_i
HOST = ENV['HOST'] || '0.0.0.0'
SPITCAST = 'https://api.spitcast.com'

# Only forward known read-only forecast endpoints — blocks open-proxy abuse.
ALLOWED = %r{\A/api/(spot|spot_forecast/\d+/\d+/\d+/\d+|buoy_tide/\d+/\d+/\d+/\d+|buoy_ndfd/\d+/\d+/\d+/\d+|buoy_ww3/\d+/\d+/\d+/\d+|buoy_ndbc/\d+/\d+/\d+/\d+)\z}

class SpitcastProxyServlet < WEBrick::HTTPServlet::AbstractServlet
  def do_GET(req, res)
    path = req.path.sub(%r{\A/api/spitcast}, '')

    unless path.match?(ALLOWED)
      res.status = 403
      res['Content-Type'] = 'application/json'
      res.body = { error: 'Forbidden' }.to_json
      return
    end

    uri = URI("#{SPITCAST}#{path}")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.read_timeout = 15
    http.open_timeout = 10

    request = Net::HTTP::Get.new(uri.request_uri)
    request['User-Agent'] = 'SESH-surf-guide/1.0'
    upstream = http.request(request)
    res.status = upstream.code.to_i
    res['Content-Type'] = upstream['Content-Type'] || 'application/json'
    res['Cache-Control'] = 'public, max-age=300'
    res.body = upstream.body
  rescue StandardError => e
    res.status = 502
    res['Content-Type'] = 'application/json'
    res.body = { error: e.message }.to_json
  end
end

DATA_DIR = File.join(ROOT, 'data')
ACCOUNTS_PATH = File.join(DATA_DIR, 'accounts.json')
SESSION_TTL = 60 * 60 * 24 * 30
AVATAR_RE = %r{\Adata:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+\z}
STORE_LOCK = Mutex.new

def empty_store
  { 'users' => {}, 'emails' => {}, 'sessions' => {} }
end

def load_store
  return empty_store unless File.exist?(ACCOUNTS_PATH)

  parsed = JSON.parse(File.read(ACCOUNTS_PATH))
  empty_store.merge(parsed.slice('users', 'emails', 'sessions'))
rescue JSON::ParserError
  empty_store
end

def save_store(store)
  FileUtils.mkdir_p(DATA_DIR)
  File.write(ACCOUNTS_PATH, JSON.generate(store))
end

def auth_fail(message, status)
  raise StandardError.new(message).tap { |err| err.define_singleton_method(:status) { status } }
end

def normalize_email(raw)
  email = raw.to_s.strip.downcase
  auth_fail('Enter a valid email', 400) if email.length > 120 || !email.match?(/\A[^\s@]+@[^\s@]+\.[^\s@]+\z/)
  email
end

def normalize_name(raw)
  name = raw.to_s.gsub(/[\u0000-\u001F]/, '').strip
  auth_fail('Name needs 1–40 characters', 400) if name.empty? || name.length > 40
  name
end

def check_password(raw)
  password = raw.to_s
  auth_fail('Password needs at least 6 characters', 400) if password.length < 6 || password.length > 100
  password
end

def normalize_spot_ids(raw)
  return [] unless raw.is_a?(Array)

  ids = []
  raw.each do |value|
    id = Integer(value, exception: false)
    next if id.nil? || id <= 0 || ids.include?(id)

    ids << id
    break if ids.length >= 10
  end
  ids
end

def normalize_quiver_ids(raw)
  return [] unless raw.is_a?(Array)

  allowed = %w[longboard midlength shortboard fish bodyboard]
  raw.map(&:to_s).select { |id| allowed.include?(id) }
end

def normalize_avatar(value)
  return nil if value.nil? || value == ''
  auth_fail('Profile photo must be a small image', 400) unless value.is_a?(String) && value.length <= 180_000 && value.match?(AVATAR_RE)

  value
end

def public_user(record)
  {
    'id' => record['id'],
    'name' => record['name'],
    'email' => record['email'],
    'avatar' => record['avatar'],
    'favoriteIds' => record['favoriteIds'] || [],
    'quiverIds' => record['quiverIds'] || []
  }
end

def hash_password(password, salt_hex)
  salt = [salt_hex].pack('H*')
  OpenSSL::KDF.pbkdf2_hmac(password, salt: salt, iterations: 120_000, length: 32, hash: 'sha256').unpack1('H*')
end

def hashes_match?(left, right)
  return false unless left.is_a?(String) && right.is_a?(String) && left.bytesize == right.bytesize

  diff = 0
  left.bytes.each_with_index { |byte, index| diff |= byte ^ right.getbyte(index) }
  diff.zero?
end

def bearer_token(req)
  header = req['Authorization'].to_s
  match = header.match(/\ABearer\s+([a-f0-9]{64})\z/i)
  match && match[1].downcase
end

def read_json_body(req)
  raw = req.body.to_s
  return {} if raw.empty?

  parsed = JSON.parse(raw)
  parsed.is_a?(Hash) ? parsed : {}
rescue JSON::ParserError
  {}
end

def prune_sessions(store)
  now = Time.now.to_i
  store['sessions'].delete_if { |_token, session| !session.is_a?(Hash) || session['exp'].to_i < now }
end

class AuthServlet < WEBrick::HTTPServlet::AbstractServlet
  def service(req, res)
    res['Access-Control-Allow-Origin'] = '*'
    res['Cache-Control'] = 'no-store'
    if req.request_method == 'OPTIONS'
      res.status = 204
      res['Access-Control-Allow-Methods'] = 'GET, POST, PUT, OPTIONS'
      res['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
      return
    end

    action = req.path_info.to_s.sub(%r{\A/}, '').sub(%r{/\z}, '')
    body = send_auth(action, req)
    res.status = body.delete('status') || 200
    res['Content-Type'] = 'application/json'
    res.body = JSON.generate(body)
  rescue StandardError => e
    status = e.respond_to?(:status) ? e.status : 500
    res.status = status
    res['Content-Type'] = 'application/json'
    message = status == 500 ? 'Could not update your profile' : e.message
    res.body = { error: message }.to_json
  end

  def send_auth(action, req)
    case [action, req.request_method]
    when ['signup', 'POST'] then signup(read_json_body(req))
    when ['login', 'POST'] then login(read_json_body(req))
    when ['logout', 'POST'] then logout(req)
    when ['me', 'GET'] then me(req)
    when ['profile', 'PUT'] then update_profile(req, read_json_body(req))
    else
      auth_fail('Not found', 404)
    end
  end

  def signup(body)
    email = normalize_email(body['email'])
    name = normalize_name(body['name'])
    password = check_password(body['password'])
    STORE_LOCK.synchronize do
      store = load_store
      auth_fail('That email already has a profile', 409) if store['emails'][email]
      salt = SecureRandom.hex(16)
      record = {
        'id' => SecureRandom.uuid,
        'email' => email,
        'name' => name,
        'salt' => salt,
        'passwordHash' => hash_password(password, salt),
        'avatar' => nil,
        'favoriteIds' => [],
        'quiverIds' => [],
        'createdAt' => Time.now.utc.iso8601
      }
      store['users'][record['id']] = record
      store['emails'][email] = record['id']
      token = create_session(store, record['id'])
      save_store(store)
      { 'token' => token, 'user' => public_user(record), 'status' => 201 }
    end
  end

  def login(body)
    email = normalize_email(body['email'])
    password = body['password'].to_s
    auth_fail("Email or password doesn't match", 401) if password.empty? || password.length > 100
    STORE_LOCK.synchronize do
      store = load_store
      record = store['users'][store['emails'][email]]
      salt = record ? record['salt'] : '00112233445566778899aabbccddeeff'
      hash = hash_password(password, salt)
      auth_fail("Email or password doesn't match", 401) unless record && hashes_match?(hash, record['passwordHash'].to_s)
      token = create_session(store, record['id'])
      save_store(store)
      { 'token' => token, 'user' => public_user(record) }
    end
  end

  def logout(req)
    token = bearer_token(req)
    STORE_LOCK.synchronize do
      store = load_store
      store['sessions'].delete(token) if token
      save_store(store)
    end
    { 'ok' => true }
  end

  def me(req)
    record = current_user(req)
    auth_fail('Sign in again', 401) unless record
    { 'user' => public_user(record) }
  end

  def update_profile(req, body)
    STORE_LOCK.synchronize do
      store = load_store
      token = bearer_token(req)
      session = token && store['sessions'][token]
      auth_fail('Sign in again', 401) unless session && session['exp'].to_i >= Time.now.to_i
      record = store['users'][session['userId']]
      auth_fail('Sign in again', 401) unless record
      record['name'] = normalize_name(body['name']) if body.key?('name')
      record['avatar'] = normalize_avatar(body['avatar']) if body.key?('avatar')
      record['favoriteIds'] = normalize_spot_ids(body['favoriteIds']) if body.key?('favoriteIds')
      record['quiverIds'] = normalize_quiver_ids(body['quiverIds']) if body.key?('quiverIds')
      record['updatedAt'] = Time.now.utc.iso8601
      save_store(store)
      { 'user' => public_user(record) }
    end
  end

  def current_user(req)
    STORE_LOCK.synchronize do
      store = load_store
      token = bearer_token(req)
      session = token && store['sessions'][token]
      return nil unless session && session['exp'].to_i >= Time.now.to_i

      store['users'][session['userId']]
    end
  end

  def create_session(store, user_id)
    prune_sessions(store)
    token = SecureRandom.hex(32)
    store['sessions'][token] = { 'userId' => user_id, 'exp' => Time.now.to_i + SESSION_TTL }
    token
  end
end

class NoCacheFileHandler < WEBrick::HTTPServlet::FileHandler
  def do_GET(req, res)
    if req.path == '/data' || req.path.start_with?('/data/')
      res.status = 404
      res['Content-Type'] = 'text/plain'
      res.body = "Not found\n"
      return
    end
    super
    if req.path == '/' || req.path.end_with?('/') || req.path.match?(/\.(html|css|js|svg)$/)
      res['Cache-Control'] = 'no-store, max-age=0'
    end
  end
end

server = WEBrick::HTTPServer.new(
  Port: PORT,
  BindAddress: HOST,
  Logger: WEBrick::Log.new($stderr, WEBrick::BasicLog::WARN),
  AccessLog: []
)

server.mount('/', NoCacheFileHandler, ROOT)
server.mount('/api/spitcast', SpitcastProxyServlet)
server.mount('/api/auth', AuthServlet)
trap('INT') { server.shutdown }
puts "SoCal Surf Guide → http://#{HOST}:#{PORT}"
server.start
