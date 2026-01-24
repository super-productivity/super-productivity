import { Plugin } from 'vite';
import path from 'path';
import fs from 'fs';

export interface SuperProductivityPluginOptions {
  /**
   * Whether to inline assets (JS/CSS) into index.html.
   * Useful for plugins with UI that need to be single-file.
   * Default: true
   */
  inlineAssets?: boolean;
  /**
   * Directory to copy the build output to.
   * Useful for watching and auto-updating the plugin in the main app.
   */
  copyTo?: string;
}

export const superProductivityPlugin = (
  options: SuperProductivityPluginOptions = {},
): Plugin => {
  const { inlineAssets = true, copyTo } = options;

  return {
    name: 'super-productivity-plugin',
    config: () => {
      return {
        build: {
          outDir: 'dist',
          emptyOutDir: true,
          rollupOptions: {
            input: {
              // We try to detect input files, but user can override
              plugin: path.resolve(process.cwd(), 'src/plugin.ts'),
              ...(fs.existsSync(path.resolve(process.cwd(), 'src/index.html'))
                ? { index: path.resolve(process.cwd(), 'src/index.html') }
                : {}),
            },
            output: {
              entryFileNames: '[name].js',
              chunkFileNames: '[name]-[hash].js',
              assetFileNames: '[name].[ext]',
            },
          },
          copyPublicDir: false,
        },
        publicDir: 'src/assets',
      };
    },
    closeBundle: {
      order: 'post',
      handler: () => {
        const distDir = path.resolve(process.cwd(), 'dist');

        // 1. Copy manifest.json
        const manifestSrc = path.resolve(process.cwd(), 'src/manifest.json');
        const manifestDest = path.join(distDir, 'manifest.json');
        if (fs.existsSync(manifestSrc)) {
          if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
          fs.copyFileSync(manifestSrc, manifestDest);
        }

        // 2. Copy icon.svg
        const iconSrc = path.resolve(process.cwd(), 'src/assets/icon.svg');
        const iconDest = path.join(distDir, 'icon.svg');
        if (fs.existsSync(iconSrc)) {
          // Ensure dist exists (it should after build)
          if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
          fs.copyFileSync(iconSrc, iconDest);
        }

        // 2.5. Copy i18n folder if it exists
        const i18nSrcDir = path.resolve(process.cwd(), 'i18n');
        if (fs.existsSync(i18nSrcDir) && fs.statSync(i18nSrcDir).isDirectory()) {
          try {
            const i18nDestDir = path.join(distDir, 'i18n');
            if (!fs.existsSync(i18nDestDir)) {
              fs.mkdirSync(i18nDestDir, { recursive: true });
            }

            const i18nFiles = fs.readdirSync(i18nSrcDir);
            let copiedCount = 0;
            for (const file of i18nFiles) {
              if (file.endsWith('.json')) {
                fs.copyFileSync(
                  path.join(i18nSrcDir, file),
                  path.join(i18nDestDir, file),
                );
                copiedCount++;
              }
            }

            if (copiedCount > 0) {
              console.log(`📋 Copied ${copiedCount} i18n file(s)`);
            }
          } catch (error) {
            console.warn('⚠️  Failed to copy i18n files:', error);
          }
        }

        // 3. Handle index.html and inlining
        const htmlPath = path.join(distDir, 'index.html');

        // Sometimes Vite outputs index.html in dist/src/index.html depending on input config
        // Let's try to find it and move it to root if needed
        const nestedHtmlPath = path.join(distDir, 'src/index.html');
        if (fs.existsSync(nestedHtmlPath) && !fs.existsSync(htmlPath)) {
          fs.renameSync(nestedHtmlPath, htmlPath);
          // Try to remove the src directory if empty or just contains html
          try {
            fs.rmSync(path.join(distDir, 'src'), { recursive: true, force: true });
          } catch (e) {
            // ignore
          }
        }

        if (inlineAssets && fs.existsSync(htmlPath)) {
          let html = fs.readFileSync(htmlPath, 'utf8');
          const jsPath = path.join(distDir, 'index.js');
          const cssPath = path.join(distDir, 'index.css');

          // Inline JS
          if (fs.existsSync(jsPath)) {
            const js = fs.readFileSync(jsPath, 'utf8');
            html = html.replace(
              /<script([^>]*)src="[^"]*index\.js"[^>]*><\/script>/g,
              (match, attrs) => {
                if (attrs.includes('type="module"') || match.includes('type="module"')) {
                  return `<script type="module">${js}</script>`;
                }
                return `<script>${js}</script>`;
              },
            );
            // Also handle module preload links which might be generated
            html = html.replace(/<link rel="modulepreload" href="[^"]*index\.js">/g, '');
          }

          // Inline CSS
          if (fs.existsSync(cssPath)) {
            const css = fs.readFileSync(cssPath, 'utf8');
            html = html.replace(
              /<link[^>]*rel="stylesheet"[^>]*href="[^"]*index\.css"[^>]*>/g,
              `<style>${css}</style>`,
            );
          }

          fs.writeFileSync(htmlPath, html);
          console.log('✅ Assets inlined successfully');
        }

        // 4. Copy to destination if specified
        if (copyTo) {
          const destDir = path.resolve(process.cwd(), copyTo);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }

          // Recursive copy function
          const copyRecursive = (src: string, dest: string): void => {
            const entries = fs.readdirSync(src, { withFileTypes: true });
            if (!fs.existsSync(dest)) fs.mkdirSync(dest);

            for (const entry of entries) {
              const srcPath = path.join(src, entry.name);
              const destPath = path.join(dest, entry.name);

              if (entry.isDirectory()) {
                copyRecursive(srcPath, destPath);
              } else {
                fs.copyFileSync(srcPath, destPath);
              }
            }
          };

          copyRecursive(distDir, destDir);
          console.log(`✅ Copied build to ${copyTo}`);
        }
      },
    },
  };
};
