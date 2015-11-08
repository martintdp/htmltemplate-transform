var fs = require('fs');
var path = require('path');
var assert = require('assert');

var transform = require('../..');
var replaceBreak = require('../../plugins/replace-break');

describe('replace-break transform', function() {
    ['001', '002'].forEach(function(n) {
        var filename = 'template.' + n + '.tmpl';

        it(filename, function(done) {
            var template = path.join(__dirname, filename);
            var expected = JSON.parse(
                fs.readFileSync(
                    path.join(__dirname, 'ast.' + n + '.json'),
                    'utf8'
                )
            );

            transform(template)
                .using(
                    replaceBreak({
                        loopTags: ['TMPL_LOOP', 'TMPL_FOR']
                    })
                )
                .toAST(function(err, ast) {
                    if (err) {
                        done(err);
                    } else {
                        assert.deepEqual(ast, expected);

                        done();
                    }
                });
        });
    });
});