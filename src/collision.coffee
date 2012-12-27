class breve.CollisionDetectorBase
  constructor: -> 
    @objectPairs = []
    @bounds = []
    @dimensions = [[],[]]
    @objectMap = {}
  
  updateBoundsList: (objects) ->
    n = 0

    for obj in objects
      id = obj.get('id')
      if !@objectMap[id]
        @objectMap[id] = true
        
        _.each(@dimensions, (dim, i) =>
          location = @location(obj)
          radius = @radius(obj)
      
          dim.push({type: 'min', value: location.elements[i] - radius, agent: obj})
          dim.push({type: 'max', value: location.elements[i] + radius, agent: obj})
        )
        
        n += 1
    
  sweepAndPrune: (objects) ->
    @updateBoundsList(objects)
    _.each(@dimensions, (dim, i) =>
      @insertionSort(dim, @_compareBounds, @_swapBounds)
    )
    
    []
  
  _compairBounds: (a, b) ->
    a.value - b.value
    
  _swapBounds: (a, b, context) =>
    pair = @pair(a.agent, b.agent)
    console.log("Swapping " + b.agent.get('id') + ' ' + a.agent.get('id'))
    
  # Insertion sort.
  # 
  # Why, in 2012, am I writing my own sorting algorithm?  Because efficient sweep-and-prune requires
  # hooking into the swapping of two entries in the list, and furthermore takes advantage of the 
  # spatial coherence of insertion sort, which should be more performant than quicksort for simulation
  # type applications.
  
  insertionSort: (array, predicate = null, swap = null, context = null) ->
    predicate ||= (i, j) -> i - j
    
    for index in [1..array.length-1]
      activeIndex = index
      compareIndex = index - 1
      
      while compareIndex >= 0 && predicate(array[activeIndex], array[compareIndex]) <= 0
        swap(array[activeIndex], array[compareIndex], context) if swap != null
        
        tmp                 = array[compareIndex]
        array[compareIndex] = array[activeIndex]
        array[activeIndex]  = tmp
        
        compareIndex -= 1
        activeIndex  -= 1
    
    array
      
  # Computes collision candidate pairs in each dimension
  prune: () ->
  
  # 
  _markOverlap: (pair, dimension) ->
    pair.overlaps += 1
  
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
    pairs = @sweepAndPrune(objects)
    
    for i in [1..objects.length-1]
      for j in [0..(i-1)]
        pair = @checkPair(objects[i], objects[j], time)

        if pair.collision
          objects[j].collide(objects[i], pair.collision)
          
          pair.collision.normal = pair.collision.normal.multiply(-1)
          objects[i].collide(objects[j], pair.collision)
          
  checkPair: (o1, o2, time) ->
    pair = @pair(o1, o2)

    if o1.collide && o2.collide && pair.time != time
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