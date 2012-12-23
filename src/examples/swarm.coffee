class breve.Examples.Boid extends breve.Agent
  setup: (attrs) ->
    super(attrs)
    @set("location", breve.random.vector([-250,-250], [250,250]))
    @set("velocity", breve.random.vector([-50,-50], [50,50]))
    @set("radius", 5)
    @set("image", "html/images/arrow.png")
    
    @set('center_scale',0.1)
    @set('alignment_scale', 15)
    @set('cohesion_scale', 2)
    @set('separation_scale', 25)
    @set('wander_scale', 10)

    @crowdingDistance = 3
    @velocityDamping = .99
    @accelerationScale = .75

  step: (step) ->
    super(step)
    
    neighbors = _.filter(@neighbors(20), (i) => @angleTo(i) < 1.5)

    sum = breve.sumVectors([@centerUrge(), @wanderUrge(), @cohesionUrge(neighbors), @alignmentUrge(neighbors), @separationUrge(neighbors)])
    
    @set('acceleration', sum.multiply(@accelerationScale))
    @set('heading', @get('velocity').angleFrom(breve.vector([1, 0])) * (if @get('velocity').Y() < 0.0 then -1.0 else 1.0))
    @set('velocity', @get('velocity').multiply(@velocityDamping))
 
  centerUrge: ->
    @get('location').multiply(-@get('center_scale'))

  cohesionUrge: (neighbors) ->
    return breve.vector([0,0]) if neighbors.length == 0

    @get('location').subtract(@_sumProperty(neighbors, 'location').multiply(1.0/neighbors.length)).toUnitVector().multiply(@get('cohesion_scale'))

  alignmentUrge: (neighbors) ->
    return breve.vector([0,0]) if neighbors.length == 0

    @_sumProperty(neighbors, 'velocity').toUnitVector().multiply(@get('alignment_scale'))
    
  separationUrge: (neighbors) ->
    neighbors = _.filter(neighbors, (i) => @distanceTo(i) < @crowdingDistance)
    return breve.vector([0,0]) if neighbors.length == 0

    breve.sumVectors(_.map(neighbors, (l) => @get('location').subtract(l.get('location')))).toUnitVector().multiply(@get('separation_scale'))
    
  wanderUrge: ->
    breve.random.vector([-1,-1], [1,1]).toUnitVector().multiply(@get('wander_scale'))
    
  _sumProperty: (neighbors, property) ->
    breve.sumVectors(_.map(neighbors, (agent) => agent.get(property)))
