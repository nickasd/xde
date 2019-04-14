const gulp = require('gulp'),
	  process = require('process'),
	  fs = require('fs'),
	  browserify = require('browserify'),
	  watchify = require('watchify');

const debug = process.env.NODE_ENV !== 'production';

gulp.task('browserify', (done) => {
	let makeBundle = function (input, output) {
		let bundle = browserify(input, {debug, cache: {}, packageCache: {}})
			.plugin(watchify);
		let bundler = function () {
			bundle.bundle()
			.on('error', (error) => { console.error(error); })
			.pipe(fs.createWriteStream(output));
		}
		bundle.on('update', bundler)
			.on('log', (...args) => { console.log(...args); });
		bundler();
	};

	makeBundle('client/index.js', 'dist/index.js');
	done()
});
