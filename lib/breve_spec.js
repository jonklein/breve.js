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
