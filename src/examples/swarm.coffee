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
    
    @set('acceleration', @centerUrge().add(@wanderUrge()))
      
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