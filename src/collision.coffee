class breve.CollisionDetector
  constructor: -> 
    @dimensions = [[],[],[]]
  
  setObjects: (objects) ->
    for obj in objects
      for dim in @dimensions
        dim.push({})
    
    
    
  pruneAndSweep: () ->
    _.each(@dimensions, (list, i) ->
      list.sort((a,b) =>
        a.bounds[i] - b.bounds[i]
      )
    )

  detect: (objects) ->
    collisions = 0
    for i in [1..objects.length-1]
      for j in [0..(i-1)]
        if collision = breve.CollisionDetector.checkPair(objects[i], objects[j])
          collisions += 1
          
          objects[j].collide(objects[i], collision)
          
          collision.normal = collision.normal.multiply(-1)
          objects[i].collide(objects[j], collision)
          
  @checkPair: (o1, o2) ->
    separation = o2.get('location').subtract(o1.get('location'))
    depth = separation.modulus() - (o1.get('radius') + o2.get('radius'))

    if depth < 0
      normal = separation.toUnitVector()
      force = o1.get('velocity').dot(normal) - o2.get('velocity').dot(normal)

      result =
        point:  separation.multiply(.5).add(o1.get('location'))
        depth:  depth
        normal: normal
        force:  force
