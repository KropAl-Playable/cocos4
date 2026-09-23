const { join } = require('path');
const { emptyDir, readFile, writeFile } = require('fs-extra');
const { dtsBundler } = require('@cocos/ccbuild');
const { magenta } = require('chalk');

const prefix = ''.padStart(20, '=');
console.log(magenta(`${prefix} Build declarations ${prefix}`));

(async function exec () {
    const PATHS = {
        engine: join(__dirname, '..'),
        out: join(__dirname, '..', 'bin', '.declarations'),
    };
    await emptyDir(PATHS.out);

    await dtsBundler.build({
        engine: PATHS.engine,
        outDir: PATHS.out,
        withIndex: true,
        withExports: false,
        withEditorExports: true,
    });

    // Projects using a custom engine reference this generated declaration bundle.
    // Keep the runtime syntax target conservative, but expose current ECMAScript
    // library typings (Array.at, Object.hasOwn, Promise.any, etc.) to TS/VS Code.
    const ccDeclarationPath = join(PATHS.out, 'cc.d.ts');
    const ccDeclaration = await readFile(ccDeclarationPath, 'utf8');
    const esNextReference = '/// <reference lib="esnext" />\n';
    if (!ccDeclaration.startsWith(esNextReference)) {
        await writeFile(ccDeclarationPath, esNextReference + ccDeclaration, 'utf8');
    }
}());
