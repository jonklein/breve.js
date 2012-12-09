class Mask.Examples.BraitenbergVehicle extends Mask.Agent
  setup: (attrs) ->
    super(attrs)
    @set("location", Mask.vector([250,250]))
    @set("radius", 80)

class Mask.Examples.BraitenbergSensor extends Mask.Agent
  setup: (attrs) ->
    
class Mask.Examples.BraitenbergLight extends Mask.Agent
  setup: (attrs) ->
    super(attrs)
    @set("radius", 4)
    @set("color", [.5,0,0,1])
    @set("image", "http://www.bigpark.com/img/games/toy-car.png")
