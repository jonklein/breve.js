class breve.CollisionDetectorBase
  constructor: -> 
    @objectPairs = []
    @bounds = []
  
  setObjects: (objects) ->
    for obj in objects
      for dim in @dimensions
        dim.push({})    
    
  sweepAndPrune: () ->
    _.each(@dimensions, (list, i) ->
      list.sort((a,b) =>
        a.bounds[i] - b.bounds[i]
      )
    )
    
  # Sorts the bounds in each dimension
  sweep: () ->
    
  # Computes collision candidate pairs in each dimension
  prune: () ->
    
  
  # Return a collision pair record for the given object pair
  pair: (o1, o2) ->
    id1 = o1.get('id')
    id2 = o2.get('id')
    
    key = if id1 < id2 then (id1 + id2) else (id2 + id1)
    
    @objectPairs[key] ||= {}
  
  # Return a list of neighbors in under a given radius 
  neighbors: (agent, allAgents, radius) ->
    _.filter(allAgents, (otherAgent) => agent != otherAgent && @checkPair(agent, otherAgent).distance < radius)

  detect: (objects, time) ->
    for i in [1..objects.length-1]
      for j in [0..(i-1)]
        pair = @checkPair(objects[i], objects[j], time)

        if pair.collision
          objects[j].collide(objects[i], pair.collision)
          
          pair.collision.normal = pair.collision.normal.multiply(-1)
          objects[i].collide(objects[j], pair.collision)
          
  checkPair: (o1, o2, time) ->
    pair = @pair(o1, o2)

    if pair.time != time
      separation = @location(o2).subtract(@location(o1))
    
      pair.distance = separation.modulus()
      pair.depth = depth
      pair.time = time
      pair.collision = null

      depth = (pair.distance - (@radius(o1) + @radius(o2)))/2.0

      if depth < 0.0
        normal = separation.toUnitVector()
        force = @velocity(o1).dot(normal) - @velocity(o2).dot(normal)

        pair.collision =
          point:  separation.multiply(.5).add(@location(o1))
          depth:  depth
          normal: normal
          force:  force

    pair
      
class breve.CollisionDetector extends breve.CollisionDetectorBase
  location: (obj) ->
    obj.get('location')
    
  velocity: (obj) ->
    obj.get('velocity')
    
  radius: (obj) ->
    obj.get('radius')