class breve.Examples.Boid extends breve.Agent
  setup: (attrs) ->
    super(attrs)
    @set("location", breve.randomVector([-100,-100], [100,100]))
    @set("radius", 6)
    @set("image", "html/images/arrow.png")
    
    @set('center_scale', 80)
    @set('wander_scale', 500)

  step: (step) ->
    super(step)
    
    neighbors = @getNeighbors(50)
    
    @set('acceleration', @centerUrge().add(@wanderUrge()))
    @set('heading', @get('velocity').angleFrom(breve.vector([1, 0])) * (if @get('velocity').Y() < 0.0 then -1.0 else 1.0))
      
  centerUrge: ->
    @get('location').toUnitVector().multiply(-1 * @get('center_scale'))

  flockUrge: ->
    0

  velocityUrge: ->
    0
    
  spacingUrge: ->
    0
    
  wanderUrge: ->
    breve.randomVector([-1,-1], [1,1]).toUnitVector().multiply(@get('wander_scale'))