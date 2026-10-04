// Builds:
//   desktop  dist/main.js, dist/preload.js, dist/renderer/*   (Electron)
//   web      dist/web/*                                         (served by the Sigil server at /app)
//   demo     dist/demo/sigil-demo.html                          (one self-contained file, simulated server inside)
// Usage: node build.mjs [--prod] [--watch] [--only=desktop,web,demo]
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const prod = args.includes('--prod');
const only = (args.find((a) => a.startsWith('--only='))?.slice(7) ?? 'desktop,web,demo').split(',');

const common = { bundle: true, sourcemap: !prod, minify: prod, logLevel: 'info', target: 'es2022' };
const browser = {
  ...common, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'css' },
  define: { 'process.env.NODE_ENV': prod ? '"production"' : '"development"' },
};

const builds = [];
if (only.includes('desktop')) {
  fs.mkdirSync('dist/renderer', { recursive: true });
  fs.copyFileSync('src/renderer/index.html', 'dist/renderer/index.html');
  builds.push(
    { ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', platform: 'node', format: 'cjs', external: ['electron'] },
    { ...common, entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.js', platform: 'node', format: 'cjs', external: ['electron'] },
    { ...browser, entryPoints: ['src/renderer/main.tsx'], outfile: 'dist/renderer/app.js' },
  );
}
if (only.includes('web')) {
  fs.mkdirSync('dist/web', { recursive: true });
  fs.copyFileSync('src/web/index.html', 'dist/web/index.html');
  builds.push({ ...browser, entryPoints: ['src/web/main.tsx'], outfile: 'dist/web/app.js' });
}

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}

if (only.includes('demo') && !watch) {
  const r = await esbuild.build({
    ...browser, sourcemap: false, minify: true, write: false, outdir: 'dist/demo-tmp',
    entryPoints: ['src/web/demo/demo.tsx'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
  });
  const js = r.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/(script)/gi, '<\\/$1');
  const css = r.outputFiles.find((f) => f.path.endsWith('.css')).text.replace(/<\/(style)/gi, '<\\/$1');
  const html = `<title>Sigil</title>
<meta name="description" content="Claim a rare username, wear it, and chat end-to-end encrypted. Demo with a simulated server.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700;800&family=Roboto+Flex:opsz,slnt,wdth,wght@8..144,-10..0,25..151,100..1000&display=swap">
<style>:root{color-scheme:dark}html,body{height:100%;background:#101116}${css}</style>
<div id="root"></div>
<script>${js}</script>
`;
  fs.mkdirSync('dist/demo', { recursive: true });
  fs.writeFileSync('dist/demo/sigil-demo.html', html);
  console.log(`  dist/demo/sigil-demo.html  ${(html.length / 1024).toFixed(0)}kb`);
}
