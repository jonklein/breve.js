describe 'breve.CollisionDetector ', ->
  beforeEach ->
    @collider = new breve.CollisionDetector()
    
  it 'shloud exist', ->
    expect(@collider).toNotEqual(null)