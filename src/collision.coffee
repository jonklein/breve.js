# Sweep-and-Prune broadphase collision candidate detection.
#
# Sorts bounding minima/maxima for all objects in each dimension, then steps through 
# bounding lists to find overlapping bounds (within some threshold) in each dimension.
# Used both for general broadphase collision detection, and with larger thresholds for 
# neighbor detection.
#
# This could be sped up for general collision detection by hooking into the insertionSort
# value swap and updating records only when bounds get sorted, thus avoid the need to 
# additional passes through the sorted bound lists.  However, such an approach requires
# significant additional bookkeeping, and does not easily enable neighbor detection with
# arbitrary search radii, so it's not likely worth the tradeoff.
class breve.CollisionSweepAndPruneBase
  @MIN = 1
  @MAX = 2
  
  constructor: -> 
    @sortedBoundLists = [[],[]]
    @objectMap = {}
    
  candidates: (obj, radius) ->
    candidateLists = []
    radius   = @radius(obj)

    for i in [0..@sortedBoundLists.length - 1]
      boundList = @sortedBoundLists[i]
      candidates = []
      location = @location(obj).elements[i]

      for bound in boundList
        if bound.agent != obj && Math.abs(bound.value - location) <= radius
          candidates.push(bound.agent)
        else if bound.value > location + radius
          break

      candidateLists.push(candidates)

    _.intersection.apply(this, candidateLists)

  update: (objects, time) ->
    @_updateBoundsList(objects)

    for boundList in @sortedBoundLists
      @_insertionSort(boundList, @_compareBounds)

  _updateBoundsList: (objects) ->
    for obj in objects
      id = obj.get('id')
      if !@objectMap[id]
        @objectMap[id] = true

        for dim in @sortedBoundLists
          dim.push({type: breve.CollisionSweepAndPruneBase.MIN, value: 0, agent: obj})
          dim.push({type: breve.CollisionSweepAndPruneBase.MAX, value: 0, agent: obj})

    _.each(@sortedBoundLists, (dim, i) =>
      for bound in dim
        r = @radius(bound.agent)
        bound.value = @location(bound.agent).elements[i] + (if (bound.type == breve.CollisionSweepAndPruneBase.MAX) then r else -r)
    )

  _compareBounds: (a, b) ->
    a.value - b.value

  # Insertion sort.
  # 
  # Why, in 2012, am I writing my own sorting algorithm?  Because efficient sweep-and-prune requires
  # hooking into the swapping of two entries in the list, and furthermore takes advantage of the 
  # spatial coherence of insertion sort, which should be more performant than quicksort for physical 
  # simulation type applications.
  _insertionSort: (array, predicate = null, swap = null, context = null) ->
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

class breve.CollisionSweepAndPrune extends breve.CollisionSweepAndPruneBase
  location: (obj) ->
    obj.get('location')

  velocity: (obj) ->
    obj.get('velocity')

  radius: (obj) ->
    obj.get('radius')

class breve.CollisionDetectorBase
  constructor: -> 
    @objectPairs = {}
    @broadphase = new breve.CollisionSweepAndPrune()
  
  # Return a list of neighbors in under a given radius 
  neighbors: (agent, allAgents, radius, time) ->
    candidates = @broadphase.candidates(agent, radius)
    _.filter(@broadphase.candidates(agent, radius), (otherAgent) => agent != otherAgent && @_checkPair(agent, otherAgent, time).distance < radius)

  detect: (objects, time) ->
    @broadphase.update(objects, time)
    
    for i in objects
      if i.collide 
        for j in @broadphase.candidates(i, 0)
          
          if j.collide
            pair = @_checkPair(i, j, time)

            if pair.collision
              j.collide(i, pair.collision)
          
              pair.collision.normal = pair.collision.normal.multiply(-1)
              i.collide(j, pair.collision)
  
  # Return a collision pair record for the given object pair
  _pair: (o1, o2) ->
    id1 = o1.get('id')
    id2 = o2.get('id')
    
    key = if id1 < id2 then (id1 + id2) else (id2 + id1)
    
    @objectPairs[key] ||= {}
          
  _checkPair: (o1, o2, time) ->
    pair = @_pair(o1, o2)
    pair.collision = null

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