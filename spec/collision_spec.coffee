describe 'breve.CollisionDetectorBase ', ->
  beforeEach ->
    @collider = new breve.CollisionDetectorBase()
    @array = [5, 7, 9, 2, 3]
  
  describe 'insertion sort', ->
    it 'should sort objects with default predicate', ->
      @collider.insertionSort(@array)
      expect(@array).toEqual([2, 3, 5, 7, 9])

    it 'should use sort predicate', ->
      @collider.insertionSort(@array, (i, j) -> j - i)
      expect(@array).toEqual([9, 7, 5, 3, 2])

    it 'should invoke swap callback for each swapped pair', ->
      callbacks = 
        swap: (i, j) =>
          # swapped
          
      spyOn(callbacks, 'swap')
      
      @collider.insertionSort(@array, null, callbacks.swap)

      expect(callbacks.swap).toHaveBeenCalledWith(2, 9)
      expect(callbacks.swap).toHaveBeenCalledWith(2, 7)
      expect(callbacks.swap).toHaveBeenCalledWith(2, 5)
      
      expect(callbacks.swap).toHaveBeenCalledWith(3, 9)
      expect(callbacks.swap).toHaveBeenCalledWith(3, 7)
      expect(callbacks.swap).toHaveBeenCalledWith(3, 5)
    