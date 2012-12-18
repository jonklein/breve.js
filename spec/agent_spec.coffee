describe 'breve.Agent ', ->
  beforeEach ->
    @agent = new breve.Agent()
  
  describe 'geometry', ->
    describe 'without parents', ->
      it 'should set global_heading', ->
        @agent.set('heading', 1.57)
        @agent.step(1)
        expect(@agent.get('global_heading')).toEqual(1.57)
      
      it 'should set global_location', ->
        @agent.set('location', breve.vector([10,10]))
        @agent.step(1)
        expect(@agent.get('global_location')).toEqual(breve.vector([10,10]))
        
  describe 'with parents', ->
    beforeEach ->
      @agent.parent = @parent = new breve.Agent(null, {location: [10,10], heading: Math.PI / 2.0})
    
    it 'should set global_heading', ->
      @agent.set('heading', Math.PI / 2.0)
      @parent.step(1)
      @agent.step(1)
      expect(@agent.get('global_heading')).toEqual(Math.PI)
      
    it 'should set global_location', ->
      @agent.set('location', breve.vector([10,10]))
      @parent.step(1)
      @agent.step(1)
      expect(@agent.get('global_location')).toEqual(breve.vector([0,20]))

  it 'should compute distance to other agents', ->
    @other = new breve.Agent(null, {location: [3,4]})
    @other.step(1)
    @agent.step(1)
    expect(@agent.distanceTo(@other)).toEqual(5)
  
  it 'should compute angle to other agents', ->
    @other = new breve.Agent(null, {location: [3,3]})
    @other.step(1)
    @agent.step(1)
    expect(@agent.angleTo(@other)).toEqual(Math.PI / 4.0)
    