describe 'breve.CollisionSweepAndPrune', ->
  beforeEach ->
    @broadphase = new breve.CollisionSweepAndPrune()
    @array = [5, 7, 9, 2, 3]
    
  it 'should exist', ->
    expect(@broadphase).toNotEqual(null)
  
  describe 'broadphase collision detection', ->
    describe 'insertion sort', ->
      it 'should sort objects with default predicate', ->
        @broadphase._insertionSort(@array)
        expect(@array).toEqual([2, 3, 5, 7, 9])

      it 'should use sort predicate', ->
        @broadphase._insertionSort(@array, (i, j) -> j - i)
        expect(@array).toEqual([9, 7, 5, 3, 2])

      it 'should invoke swap callback with context value for each swapped pair', ->
        callbacks = 
          swap: (i, j) =>
            # swapped
          
        spyOn(callbacks, 'swap')
      
        @broadphase._insertionSort(@array, null, callbacks.swap, 123)

        expect(callbacks.swap).toHaveBeenCalledWith(2, 9, 123)
        expect(callbacks.swap).toHaveBeenCalledWith(2, 7, 123)
        expect(callbacks.swap).toHaveBeenCalledWith(2, 5, 123)
      
        expect(callbacks.swap).toHaveBeenCalledWith(3, 9, 123)
        expect(callbacks.swap).toHaveBeenCalledWith(3, 7, 123)
        expect(callbacks.swap).toHaveBeenCalledWith(3, 5, 123)
      
    describe 'broadphase collision candidates', ->
      beforeEach ->
        @broadphase = new breve.CollisionSweepAndPrune()
        @objects = [new breve.Agent(null, {radius: 10}), new breve.Agent(null, {radius: 10}), new breve.Agent(null, {radius: 10})]
        
      it 'should give candidates overlapping in all dimensions', ->
        @objects[0].set('location', breve.vector([10, 10]))
        @objects[1].set('location', breve.vector([20, 20]))
        @objects[2].set('location', breve.vector([40, 40]))
        @broadphase.update(@objects)
        expect(@broadphase.candidates(@objects[0], 10)).toEqual([@objects[1]])
      
      it 'should not give candidates overlapping in only one dimension', ->
        @objects[0].set('location', breve.vector([10, 10]))
        @objects[1].set('location', breve.vector([20, 100]))
        @objects[2].set('location', breve.vector([40, 40]))
        @broadphase.update(@objects)
        expect(@broadphase.candidates(@objects[0], 10)).toEqual([])
      
      it 'should not give candidates overlapping in no dimensions', ->
        @objects[0].set('location', breve.vector([10, 10]))
        @objects[1].set('location', breve.vector([100, 100]))
        @objects[2].set('location', breve.vector([40, 40]))
        @broadphase.update(@objects)
        expect(@broadphase.candidates(@objects[0], 10)).toEqual([])
