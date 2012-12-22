class breve.Examples.Ball extends breve.Agent
  setup: (attrs) =>
    super(attrs)
    @set('location', breve.vector(breve.randomRange([-250,-250],[250,250])))
    @set('velocity', breve.vector(breve.randomRange([-100,-100], [100,100])))
    @set('radius', breve.randomRange(8, 30))
    @gravity = 8

  step: (step) =>
    velocity = @get('velocity').multiply(.9992).add(breve.vector([0,@gravity * step]))
    location = @get('location')
    
    if (location.X() >= 250 - @get('radius') && velocity.X() > 0) || (location.X() < -250 + @get('radius') && velocity.X() < 0)
      velocity.elements[0] *= -1
    
    if location.Y() >= 250 - @get('radius') && velocity.Y() > 0
      velocity.elements[1] *= -1

    @set('heading', velocity.angleFrom(breve.vector([1, 0])) * (if velocity.Y() < 0.0 then -1.0 else 1.0))
    @set('velocity', velocity)
    
    super(step)

  collide: (agent, collision) ->
    @set('velocity', @get('velocity').add(collision.normal.multiply(collision.force)))