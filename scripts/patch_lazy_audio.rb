#!/usr/bin/env ruby
# Patches script.js so long sounds (music, > 15 s) are decoded only when first played and
# released when they stop. Decoding all of them up front needs ~1.6 GB of RAM, which makes
# phone browsers kill and reload the page. Idempotent; re-run after refreshing script.js.
path = ARGV[0] || File.expand_path('../extracted/bloons-td--demo-v/script.js', __dir__)
s = File.read(path, encoding: 'UTF-8')
if s.include?('createLazySoundPlayer')
  puts 'already patched'
  exit
end

def sub!(s, old, new)
  n = s.scan(old).size
  abort "expected exactly 1 match, got #{n} for: #{old[0, 60]}" unless n == 1
  s.sub!(old) { new }
end

# 1. Sound loader: long sounds become lazy players (no download/decode now)
sub!(s, 'loadSound:function(e,t,n){',
  'loadSound:function(e,t,n){' \
  'if(t.audioEngine&&t.audioEngine.createLazySoundPlayer&&"string"==typeof e.md5&&' \
  '"number"==typeof e.sampleCount&&"number"==typeof e.rate&&e.rate>0&&e.sampleCount/e.rate>15){' \
  'const lp=t.audioEngine.createLazySoundPlayer("./assets/"+e.md5,"lazy_"+(window.__lazySoundN=(window.__lazySoundN||0)+1));' \
  'return e.assetId=e.md5.split(".")[0],e.dataFormat=e.md5.split(".")[1].toLowerCase(),e.soundId=lp.id,' \
  'null!==n&&n.addSoundPlayer(lp),Promise.resolve(e)}')

# 2. Audio engine factory
sub!(s, 'decodeSoundPlayer(e){return this._decodeSound(e).then((e=>{let[t,n]=e;return new c(this,{id:t,buffer:n})}))}',
  'decodeSoundPlayer(e){return this._decodeSound(e).then((e=>{let[t,n]=e;return new c(this,{id:t,buffer:n})}))}' \
  'createLazySoundPlayer(u,i){const p=new c(this,{id:i,buffer:null});return p._lazyUrl=u,p}')

# 3. SoundPlayer: decode on first play, cancel cleanly, release after playback
sub!(s, 'onEnded(){this.emit("stop"),this.isPlaying=!1}',
  'onEnded(){this.emit("stop"),this.isPlaying=!1,this._lazyUrl&&(this.buffer=null)}' \
  '_lazyPlay(){this._wantPlay=!0;if(this._lazyLoading)return;this._lazyLoading=!0;' \
  'fetch(this._lazyUrl).then((r=>{if(!r.ok)throw new Error(r.status);return r.arrayBuffer()}))' \
  '.then((b=>this.audioEngine._decodeSound({data:{buffer:b}})))' \
  '.then((r=>{this._lazyLoading=!1;if(r&&r[1]){this.buffer=r[1];if(this._wantPlay){this._wantPlay=!1;this.play()}}' \
  'else if(this._wantPlay){this._wantPlay=!1;this.emit("stop")}}))' \
  '.catch((()=>{this._lazyLoading=!1;this._wantPlay&&(this._wantPlay=!1,this.emit("stop"))}))}')
sub!(s, 'play(){if(this.isStarting)return this.emit("stop"),void this.emit("play");',
  'play(){if(this._lazyUrl&&!this.buffer)return void this._lazyPlay();if(this.isStarting)return this.emit("stop"),void this.emit("play");')
sub!(s, 'stop(){if(!this.isPlaying)return;const e=this.take();',
  'stop(){if(this._wantPlay){this._wantPlay=!1;this.emit("stop")}if(!this.isPlaying)return;const e=this.take();this._lazyUrl&&(this.buffer=null);')
sub!(s, 'stopImmediately(){this.isPlaying&&(',
  'stopImmediately(){if(this._wantPlay){this._wantPlay=!1;this.emit("stop")}this.isPlaying&&(')

File.write(path, s, encoding: 'UTF-8')
puts 'patched'
