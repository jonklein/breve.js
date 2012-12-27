(function() {

  describe('breve.Agent ', function() {
    beforeEach(function() {
      return this.agent = new breve.Agent();
    });
    describe('geometry', function() {
      return describe('without parents', function() {
        it('should set global_heading', function() {
          this.agent.set('heading', 1.57);
          this.agent.step(1);
          return expect(this.agent.get('global_heading')).toEqual(1.57);
        });
        return it('should set global_location', function() {
          this.agent.set('location', breve.vector([10, 10]));
          this.agent.step(1);
          return expect(this.agent.get('global_location')).toEqual(breve.vector([10, 10]));
        });
      });
    });
    describe('with parents', function() {
      beforeEach(function() {
        return this.agent.parent = this.parent = new breve.Agent(null, {
          location: [10, 10],
          heading: Math.PI / 2.0
        });
      });
      it('should set global_heading', function() {
        this.agent.set('heading', Math.PI / 2.0);
        this.parent.step(1);
        this.agent.step(1);
        return expect(this.agent.get('global_heading')).toEqual(Math.PI);
      });
      return it('should set global_location', function() {
        this.agent.set('location', breve.vector([10, 10]));
        this.parent.step(1);
        this.agent.step(1);
        return expect(this.agent.get('global_location')).toEqual(breve.vector([0, 20]));
      });
    });
    it('should compute distance to other agents', function() {
      this.other = new breve.Agent(null, {
        location: [3, 4]
      });
      this.other.step(1);
      this.agent.step(1);
      return expect(this.agent.distanceTo(this.other)).toEqual(5);
    });
    return it('should compute angle to other agents', function() {
      this.other = new breve.Agent(null, {
        location: [3, 3]
      });
      this.other.step(1);
      this.agent.step(1);
      return expect(this.agent.angleTo(this.other)).toEqual(Math.PI / 4.0);
    });
  });

}).call(this);
(function() {

  describe('breve.CollisionSweepAndPrune', function() {
    beforeEach(function() {
      this.broadphase = new breve.CollisionSweepAndPrune();
      return this.array = [5, 7, 9, 2, 3];
    });
    it('should exist', function() {
      return expect(this.broadphase).toNotEqual(null);
    });
    return describe('broadphase collision detection', function() {
      describe('insertion sort', function() {
        it('should sort objects with default predicate', function() {
          this.broadphase._insertionSort(this.array);
          return expect(this.array).toEqual([2, 3, 5, 7, 9]);
        });
        it('should use sort predicate', function() {
          this.broadphase._insertionSort(this.array, function(i, j) {
            return j - i;
          });
          return expect(this.array).toEqual([9, 7, 5, 3, 2]);
        });
        return it('should invoke swap callback with context value for each swapped pair', function() {
          var callbacks,
            _this = this;
          callbacks = {
            swap: function(i, j) {}
          };
          spyOn(callbacks, 'swap');
          this.broadphase._insertionSort(this.array, null, callbacks.swap, 123);
          expect(callbacks.swap).toHaveBeenCalledWith(2, 9, 123);
          expect(callbacks.swap).toHaveBeenCalledWith(2, 7, 123);
          expect(callbacks.swap).toHaveBeenCalledWith(2, 5, 123);
          expect(callbacks.swap).toHaveBeenCalledWith(3, 9, 123);
          expect(callbacks.swap).toHaveBeenCalledWith(3, 7, 123);
          return expect(callbacks.swap).toHaveBeenCalledWith(3, 5, 123);
        });
      });
      return describe('broadphase collision candidates', function() {
        beforeEach(function() {
          this.broadphase = new breve.CollisionSweepAndPrune();
          return this.objects = [
            new breve.Agent(null, {
              radius: 10
            }), new breve.Agent(null, {
              radius: 10
            }), new breve.Agent(null, {
              radius: 10
            })
          ];
        });
        it('should give candidates overlapping in all dimensions', function() {
          this.objects[0].set('location', breve.vector([10, 10]));
          this.objects[1].set('location', breve.vector([20, 20]));
          this.objects[2].set('location', breve.vector([40, 40]));
          this.broadphase.update(this.objects);
          return expect(this.broadphase.candidates(this.objects[0], 10)).toEqual([this.objects[1]]);
        });
        it('should not give candidates overlapping in only one dimension', function() {
          this.objects[0].set('location', breve.vector([10, 10]));
          this.objects[1].set('location', breve.vector([20, 100]));
          this.objects[2].set('location', breve.vector([40, 40]));
          this.broadphase.update(this.objects);
          return expect(this.broadphase.candidates(this.objects[0], 10)).toEqual([]);
        });
        return it('should not give candidates overlapping in no dimensions', function() {
          this.objects[0].set('location', breve.vector([10, 10]));
          this.objects[1].set('location', breve.vector([100, 100]));
          this.objects[2].set('location', breve.vector([40, 40]));
          this.broadphase.update(this.objects);
          return expect(this.broadphase.candidates(this.objects[0], 10)).toEqual([]);
        });
      });
    });
  });

}).call(this);
(function() {

  describe('breve.CollisionDetector ', function() {
    beforeEach(function() {
      return this.collider = new breve.CollisionDetector();
    });
    return it('shloud exist', function() {
      return expect(this.collider).toNotEqual(null);
    });
  });

}).call(this);
(function() {

  describe('breve.Engine', function() {
    return it('should exist', function() {
      return expect(new breve.Engine()).toNotEqual(null);
    });
  });

}).call(this);
beforeEach(function() {
  this.addMatchers({
    toBePlaying: function(expectedSong) {
      var player = this.actual;
      return player.currentlyPlayingSong === expectedSong && 
             player.isPlaying;
    }
  });
});
