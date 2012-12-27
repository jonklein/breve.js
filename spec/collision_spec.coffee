describe 'breve.CollisionDetector ', ->
  beforeEach ->
    @collider = new breve.CollisionDetector()
    
  it 'should exist', ->
    expect(@collider).toNotEqual(null)
  
  it 'should not perform collision detection if collide method does not exist on either object'
  
  it 'should perform collision detection if collide method exists on either object'