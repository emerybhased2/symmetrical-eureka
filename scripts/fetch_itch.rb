#!/usr/bin/env ruby
# Fetch a build from an itch.io project and merge it into a local folder.
# Usage: ruby scripts/fetch_itch.rb [--list] [--upload "NAME"] [--dest DIR] [--keep DIR] [--full]
# By default only web-playable files are merged (no NW.js runtime).
require 'net/http'
require 'uri'
require 'json'
require 'fileutils'
require 'tmpdir'
require 'optparse'

PROJECT = 'https://samadibeligaswatte1.itch.io/bloons-td-5-demo'
opts = { upload: 'Windows Bloons TD 5 Demo v4.zip',
         dest: File.expand_path('../extracted/bloons-td--demo-v', __dir__),
         list: false, keep: nil, full: false }
OptionParser.new do |o|
  o.on('--list') { opts[:list] = true }
  o.on('--upload NAME') { |v| opts[:upload] = v }
  o.on('--dest DIR') { |v| opts[:dest] = File.expand_path(v) }
  o.on('--full', 'also copy NW.js runtime (exe/dll/pak/locales); too big for git') { opts[:full] = true }
  o.on('--keep DIR', 'keep downloaded zip here') { |v| opts[:keep] = File.expand_path(v) }
end.parse!

def http_get(url, cookie = nil, limit = 8, &blk)
  raise 'too many redirects' if limit == 0
  uri = URI(url)
  Net::HTTP.start(uri.host, uri.port, use_ssl: true, read_timeout: 600) do |h|
    req = Net::HTTP::Get.new(uri)
    req['Cookie'] = cookie if cookie
    h.request(req) do |res|
      case res
      when Net::HTTPRedirection
        return http_get(URI.join(url, res['location']).to_s, nil, limit - 1, &blk)
      when Net::HTTPSuccess
        return blk ? res.read_body(&blk) : res.body
      else
        raise "GET #{url} -> #{res.code}"
      end
    end
  end
end

# 1. Project page: CSRF token + upload list
uri = URI(PROJECT)
page_res = Net::HTTP.get_response(uri)
cookies = Array(page_res.get_fields('set-cookie')).map { |c| c.split(';').first }.join('; ')
page = page_res.body
csrf = page[/csrf_token" value="([^"]+)/, 1] or abort 'csrf token not found'
uploads = page.scan(/data-upload_id="(\d+)".*?upload_name"><strong title="([^"]+)"/m)
                .map { |id, name| [name, id] }.to_h

if opts[:list]
  uploads.each { |name, id| puts "#{id}  #{name}" }
  exit
end

id = uploads[opts[:upload]] or abort "upload not found: #{opts[:upload]}\n#{uploads.keys.join("\n")}"

# 2. Ask itch.io for a signed download URL (free projects need no key)
post = Net::HTTP::Post.new(URI("#{PROJECT}/file/#{id}?source=view_game&as_props=1"))
post['Cookie'] = cookies
post['X-Requested-With'] = 'XMLHttpRequest'
post.set_form_data('csrf_token' => csrf)
res = Net::HTTP.start(uri.host, 443, use_ssl: true) { |h| h.request(post) }
abort "download request failed: #{res.code} #{res.body[0, 200]}" unless res.is_a?(Net::HTTPSuccess)
url = JSON.parse(res.body)['url'] or abort "no url in response: #{res.body[0, 200]}"

# 3. Download, extract, merge
Dir.mktmpdir('itch') do |tmp|
  zip = opts[:keep] ? File.join(FileUtils.mkdir_p(opts[:keep]).first, opts[:upload]) : File.join(tmp, 'dl.zip')
  puts "Downloading #{opts[:upload]} ..."
  File.open(zip, 'wb') { |f| http_get(url) { |chunk| f.write(chunk) } }
  out = File.join(tmp, 'out')
  system('unzip', '-q', '-o', zip, '-d', out) or abort 'unzip failed'

  # The game folder is the directory holding package.json/index.html
  root = Dir.glob(File.join(out, '**', 'package.json')).map { |p| File.dirname(p) }.min_by(&:size)
  root ||= Dir.glob(File.join(out, '**', 'index.html')).map { |p| File.dirname(p) }.min_by(&:size)
  abort 'game folder not found in archive' unless root
  # Also bring runtime files that sit next to the game folder (nw.exe, dlls, ...)
  top = Dir.children(out).size == 1 ? File.join(out, Dir.children(out).first) : out
  src = File.directory?(top) && !File.exist?(File.join(top, 'package.json')) ? top : root
  FileUtils.mkdir_p(opts[:dest])
  runtime = /\.(exe|dll|pak|bin|dat)\z|\A(locales|swiftshader)\//
  n = 0
  Dir.glob(File.join(src, '**', '*'), File::FNM_DOTMATCH).each do |f|
    next unless File.file?(f)
    rel = f.delete_prefix(src + '/')
    next if !opts[:full] && rel.match?(runtime)
    FileUtils.mkdir_p(File.dirname(File.join(opts[:dest], rel)))
    FileUtils.cp(f, File.join(opts[:dest], rel))
    n += 1
  end
  puts "Merged #{n} files into #{opts[:dest]}"
end
