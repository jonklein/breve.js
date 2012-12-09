all: mask

mask:
	sprockets -I. -Isrc manifest.mask.js > lib/mask.js
