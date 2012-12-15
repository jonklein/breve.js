class breve.Examples.BraitenbergVehicle extends breve.Agent
  setup: (attrs) ->
    super(attrs)
    @set("location", breve.vector([250,250]))
    @set("radius", 80)
    @set("image", "images/car.png")
    
    @leftSensor =  @addChild(new breve.Examples.BraitenbergSensor(@engine, {location: [65, -25]}))
    @rightSensor = @addChild(new breve.Examples.BraitenbergSensor(@engine, {location: [65,  25]}))
    
    

  step: (step) ->
    super(step)
    @set("heading", @get('heading') + 0.02)
    @set("velocity", breve.vector([10,0]).rotate(@get('heading'), [0,0]))

class breve.Examples.BraitenbergSensor extends breve.Agent
  setup: (attrs) ->
    super(attrs)
    @set("radius", 6)
    @set("color", [1,1,1,1])
    
class breve.Examples.BraitenbergLight extends breve.Agent
  setup: (attrs) ->
    super(attrs)
    @set("radius", 4)
    @set("color", [.5,0,0,1])
