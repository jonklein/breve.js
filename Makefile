all: breve

breve:
	sprockets -I. -Isrc manifest.breve.js > lib/breve.js
	sprockets -I. -Isrc manifest.spec.js > lib/breve_spec.js

doc: src/engine.coffee src/agent.coffee
	codo src/engine.coffee src/agent.coffee 
