#!/usr/bin/env ruby
# Serves the app + proxies Spitcast API (browser CORS workaround).
require 'webrick'
require 'net/http'
require 'uri'
require 'json'

ROOT = File.expand_path(__dir__)
PORT = (ENV['PORT'] || 8080).to_i
HOST = ENV['HOST'] || '0.0.0.0'
SPITCAST = 'https://api.spitcast.com'

# Only forward known read-only forecast endpoints — blocks open-proxy abuse.
ALLOWED = %r{\A/api/(spot_forecast/\d+/\d+/\d+/\d+|buoy_tide/\d+/\d+/\d+/\d+|buoy_ndfd/\d+/\d+/\d+/\d+|buoy_ww3/\d+/\d+/\d+/\d+)\z}

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

    upstream = http.get(uri.request_uri)
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

server = WEBrick::HTTPServer.new(
  Port: PORT,
  DocumentRoot: ROOT,
  BindAddress: HOST,
  Logger: WEBrick::Log.new($stderr, WEBrick::BasicLog::WARN),
  AccessLog: []
)

server.mount('/api/spitcast', SpitcastProxyServlet)
trap('INT') { server.shutdown }
puts "SoCal Surf Guide → http://#{HOST}:#{PORT}"
server.start
