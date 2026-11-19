#!/usr/bin/env ruby
# Writes assets/svg-meta.json: { "<md5>.svg" => [viewBoxX, viewBoxY, width, height] }
# The lazy costume loader uses it to size placeholder skins without downloading the SVGs.
require 'json'

dir = ARGV[0] || File.expand_path('../extracted/bloons-td--demo-v/assets', __dir__)
meta = {}
skipped = 0
Dir.glob(File.join(dir, '*.svg')).sort.each do |path|
  head = File.read(path, 4096, mode: 'rb').to_s.force_encoding('UTF-8').scrub
  tag = head[/<svg\b[^>]*>/m]
  vb = tag && tag[/\sviewBox\s*=\s*["']([^"']+)["']/, 1]
  nums = vb && vb.strip.split(/[\s,]+/).map { |v| Float(v) rescue nil }
  if nums && nums.size == 4 && nums.none?(&:nil?) && nums[2] > 0 && nums[3] > 0
    meta[File.basename(path)] = nums.map { |n| n == n.to_i ? n.to_i : n }
  else
    skipped += 1
  end
end
File.write(File.join(dir, 'svg-meta.json'), JSON.generate(meta))
puts "svg-meta.json: #{meta.size} entries, #{skipped} skipped (loaded eagerly)"
