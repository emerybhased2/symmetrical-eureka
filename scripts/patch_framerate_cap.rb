#!/usr/bin/env ruby
# Raises the TurboWarp runtime's hard 250 Hz framerate cap so the devtools
# fast-forward options (up to 20x) actually apply. Idempotent; re-run after
# refreshing script.js with fetch_itch.rb.
path = ARGV[0] || File.expand_path('../extracted/bloons-td--demo-v/script.js', __dir__)
s = File.read(path, encoding: 'UTF-8')

old = 'setFramerate(e){e>250&&(e=250),e<0&&(e=1)'
new = 'setFramerate(e){e>2000&&(e=2000),e<0&&(e=1)'

if s.include?(new)
  puts 'already patched'
  exit
end
n = s.scan(old).size
abort "expected 1 match for the framerate cap, got #{n}" unless n == 1
s.sub!(old, new)
File.write(path, s, encoding: 'UTF-8')
puts 'patched (cap raised from 250 Hz to 2000 Hz)'
