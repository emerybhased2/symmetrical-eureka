#!/usr/bin/env ruby
# Patches script.js so vector costumes load lazily (on first draw) instead of all up front.
# Idempotent. Re-run after refreshing script.js with fetch_itch.rb.
path = ARGV[0] || File.expand_path('../extracted/bloons-td--demo-v/script.js', __dir__)
s = File.read(path, encoding: 'UTF-8')
if s.include?('__lazySkins')
  puts 'already patched'
  exit
end

def sub!(s, old, new)
  n = s.scan(old).size
  abort "expected exactly 1 match, got #{n} for: #{old[0, 60]}" unless n == 1
  s.sub!(old) { new }
end

# 1. Costume loader: svg with known size -> placeholder skin, no download/parse
sub!(s, 'if(t.dataFormat=c,t.asset)return m(t,n,s);',
  'if(t.dataFormat=c,t.asset)return m(t,n,s);' \
  'if("svg"===c&&2!==s&&n.renderer&&n.renderer.createLazySVGSkin&&!t.textLayerMD5&&' \
  '"number"==typeof t.rotationCenterX&&"number"==typeof t.rotationCenterY&&' \
  '!isNaN(t.rotationCenterX)&&!isNaN(t.rotationCenterY)){' \
  'const lm=window.__svgMeta&&window.__svgMeta[e];' \
  'if(lm){t.assetId=a;t.skinId=n.renderer.createLazySVGSkin("./assets/"+e,lm,[t.rotationCenterX,t.rotationCenterY]);' \
  't.size=n.renderer.getSkinSize(t.skinId);return Promise.resolve(t)}}')

# 2. Renderer entry point
sub!(s, 'createSVGSkin(e,t){const n=this._nextSkinId++,r=new f(n,this);return r.setSVG(e,t),this._allSkins[n]=r,n}',
  'createSVGSkin(e,t){const n=this._nextSkinId++,r=new f(n,this);return r.setSVG(e,t),this._allSkins[n]=r,n}' \
  'createLazySVGSkin(e,t,n){const r=this._nextSkinId++,i=new f(r,this);return i.setLazySVG(e,t,n),this._allSkins[r]=i,r}')

# 3. SVGSkin: lazy state, load-on-first-use, neighbour prefetch
sub!(s, 'dispose(){this.resetMIPs(),this._svgImage.onload=null,super.dispose()}',
  'setLazySVG(u,m,c){this._lazyUrl=u,this._lazyRC=c,this._size[0]=m[2],this._size[1]=m[3],' \
  'this._rotationCenter[0]=c[0]-m[0],this._rotationCenter[1]=c[1]-m[1],' \
  'this._lazyIndex=(window.__lazySkins=window.__lazySkins||[]).push(this)-1}' \
  '_lazyLoad(k){const u=this._lazyUrl;if(!u)return;this._lazyUrl=null;' \
  'fetch(u).then((r=>{if(!r.ok)throw new Error(r.status);return r.text()})).then((t=>{this._lazyGone||this.setSVG(t,this._lazyRC)})).catch((()=>{}));' \
  'if(!k){const l=window.__lazySkins;for(let i=1;i<=3;i++){const n=l[this._lazyIndex+i];n&&n._lazyUrl&&n._lazyLoad(!0)}}}' \
  'dispose(){this._lazyGone=!0,this._lazyUrl=null,window.__lazySkins&&(window.__lazySkins[this._lazyIndex]=null),this.resetMIPs(),this._svgImage.onload=null,super.dispose()}')
sub!(s, 'getTexture(e){const t=e?Math.max(Math.abs(e[0]),Math.abs(e[1])):100,n=Math.min(t/100,this._maxTextureScale)',
  'getTexture(e){this._lazyUrl&&this._lazyLoad();const t=e?Math.max(Math.abs(e[0]),Math.abs(e[1])):100,n=Math.min(t/100,this._maxTextureScale)')

File.write(path, s, encoding: 'UTF-8')
puts 'patched'
