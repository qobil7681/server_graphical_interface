const path = require("path");
const glob = require("glob");
const fs = require("fs");
const gettext_parser = require('gettext-parser');
const Jed = require('jed');
const webpack = require('webpack');

const srcdir = process.env.SRCDIR || path.resolve(__dirname, '..', '..');

module.exports = class {
    constructor(options) {
        if (!options)
            options = {};
        this.subdir = options.subdir || '';
        this.reference_patterns = options.reference_patterns;
        this.wrapper = options.wrapper || 'cockpit.locale(PO_DATA);';
    }

    apply(compiler) {
        if (!webpack.Compilation) {
            // webpack v4
            compiler.hooks.emit.tapPromise(
                'CockpitPoPlugin',
                compilation => Promise.all(glob.sync(path.resolve(srcdir, 'po/*.po')).map(f => this.buildFile(f, compilation)))
            );
        } else {
            // webpack v5
            compiler.hooks.thisCompilation.tap('CockpitPoPlugin', compilation => {
                compilation.hooks.processAssets.tapPromise(
                    {
                        name: 'CockpitPoPlugin',
                        stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                    },
                    () => Promise.all(glob.sync(path.resolve(srcdir, 'po/*.po')).map(f => this.buildFile(f, compilation)))
                );
            });
        }
    }

    get_plural_expr(statement) {
        try {
            /* Check that the plural forms isn't being sneaky since we build a function here */
            Jed.PF.parse(statement);
        } catch (ex) {
            console.error("bad plural forms: " + ex.message);
            process.exit(1);
        }

        const expr = statement.replace(/nplurals=[1-9]; plural=([^;]*);?$/, '(n) => $1');
        if (expr === statement) {
            console.error("bad plural forms: " + statement);
            process.exit(1);
        }

        return expr;
    }

    build_patterns(compilation, extras) {
        const patterns = [
            // all translations for that page, including manifest.json and *.html
            `pkg/${this.subdir}.*`,
            // FIXME: https://github.com/cockpit-project/cockpit/issues/13906
            'pkg/base1/cockpit.js'
        ];

        // add translations from libraries outside of page directory
        compilation.getStats().compilation.fileDependencies.forEach(path => {
            if (path.startsWith(srcdir) && path.indexOf('node_modules/') < 0)
                patterns.push(path.slice(srcdir.length + 1));
        });

        Array.prototype.push.apply(patterns, extras);

        return patterns.map((p) => new RegExp(`^${p}:[0-9]+$`));
    }

    check_reference_patterns(patterns, references) {
        for (const reference of references) {
            for (const pattern of patterns) {
                if (reference.match(pattern)) {
                    return true;
                }
            }
        }
    }

    buildFile(po_file, compilation) {
        return new Promise((resolve, reject) => {
            const patterns = this.build_patterns(compilation, this.reference_patterns);

            const parsed = gettext_parser.po.parse(fs.readFileSync(po_file), 'utf8');
            delete parsed.translations[""][""]; // second header copy

            // cockpit.js only looks at "plural-forms" and "language"
            const chunks = [
                '{\n',
                ' "": {\n',
                `  "plural-forms": ${this.get_plural_expr(parsed.headers['plural-forms'])},\n`,
                `  "language": "${parsed.headers.language}"\n`,
                ' }'
            ];
            for (const [msgctxt, context] of Object.entries(parsed.translations)) {
                const context_prefix = msgctxt ? msgctxt + '\u0004' : ''; /* for cockpit.ngettext */

                for (const [msgid, translation] of Object.entries(context)) {
                    const references = translation.comments.reference.split(/\s/);
                    if (!this.check_reference_patterns(patterns, references))
                        continue;

                    if (translation.comments.flag === 'fuzzy')
                        continue;

                    const key = JSON.stringify(context_prefix + msgid);
                    // cockpit.js always ignores the first item
                    chunks.push(`,\n ${key}: [\n  null`);
                    for (const str of translation.msgstr) {
                        chunks.push(',\n  ' + JSON.stringify(str));
                    }
                    chunks.push('\n ]');
                }
            }
            chunks.push('\n}');

            const output = this.wrapper.replace('PO_DATA', chunks.join('')) + '\n';

            const lang = path.basename(po_file).slice(0, -3);
            if (webpack.sources) {
                // webpack v5
                compilation.emitAsset(this.subdir + 'po.' + lang + '.js', new webpack.sources.RawSource(output));
            } else {
                // webpack v4
                compilation.assets[this.subdir + 'po.' + lang + '.js'] = { source: () => output, size: () => output.length };
            }
            resolve();
        });
    }
};
