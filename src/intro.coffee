Sylvester.Vector.prototype.X = ->
  this.elements[0]

Sylvester.Vector.prototype.Y = ->
  this.elements[1]

Sylvester.Vector.prototype.Z = ->
  this.elements[2]

window.breve = 
  version: 1
  
  vector: $V
  matrix: $M
  plane: $P
  line: $L
  
  PI2: Math.PI * 2.0
  
  sumVectors: (list) ->
    _.reduce(list, (v, memo) => 
      if v then memo.add(v) else memo
    , breve.vector([0,0]))
  
  random:
    rangeScalar: (min, max) ->
      Math.random() * ((max||0.0) - (min||0.0)) + (min||0.0)
  
    vector: (min, max) ->
      breve.vector(breve.randomRange(min, max))

  randomRange: (min, max) ->
    max ||= []
    if (min.length == undefined) then @random.rangeScalar(min, max) else (@random.rangeScalar(min[i], max[i]) for i in [0..min.length-1])

  Examples: {}
  
  start: (opts) =>
    @stop()
    @engine = new breve.Engine(opts)
    @engine.start()
    @engine
  
  stop: =>
    if @engine
      @engine.stop()
      @engine = null