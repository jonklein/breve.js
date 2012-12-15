class breve.CollisionDetector
  constructor: -> 
  
  setObjects: (objects) ->
    
  pruneAndSweep: () ->
    _.each(@dimensions, (list, i) ->
      list.sort((a,b) =>
        a.bounds[i] - b.bounds[i]
      )
    )

  detect: (objects) ->
    
    