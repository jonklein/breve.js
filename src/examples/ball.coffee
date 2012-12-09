class Mask.Examples.Ball extends Mask.Agent
  setup: (attrs) =>
    super(attrs)
    @set('location', Mask.vector(Mask.randomRange([500,500])))
    @set('velocity', Mask.vector(Mask.randomRange([-100,-100], [100,100])))
    @set('radius', Mask.randomRange(10, 20))
    @gravity = 8

  step: (step) =>
    velocity = @get('velocity').multiply(.9992).add(Mask.vector([0,@gravity * step]))
    location = @get('location')
    
    if (location.X() >= 500 - @get('radius') && velocity.X() > 0) || (location.X() < @get('radius') && velocity.X() < 0)
      velocity.elements[0] *= -1
    
    if location.Y() >= 500 - @get('radius') && velocity.Y() > 0
      velocity.elements[1] *= -1

    @set('heading', velocity.angleFrom(Mask.vector([1, 0])) * (if velocity.Y() < 0.0 then -1.0 else 1.0))
    @set('velocity', velocity)
    
    super(step)
