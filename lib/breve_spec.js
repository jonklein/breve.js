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
