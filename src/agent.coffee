# The simulation Agent class.
#
# State parameters used by the Agent class include:
# * acceleration
# * velocity
# * location
# * heading
# * radius
# * color
# * global_heading
# * global_rotation
# * image
class breve.Agent
  # Constructor for breve.Agent.  Should not be overriden directly to configure agent state–override setup instead.
  constructor: (@engine, attrs) ->
    attrs ||= {}
    @state = {}
    @set('heading', attrs['heading'] || 0)
    @set('location', breve.vector(attrs['location'] || [0,0]))
    @set('velocity', breve.vector(attrs['velocity'] || [0,0]))
    @set('color', [1,1,1,1])

    @set('global_location', breve.vector([0,0]))
    @set('global_heading', 0)

    @setup(attrs)

  # Sets up the agent with a set of provided attributes. This is the override point to configure the initial state 
  # of agents based on their parameters.
  #
  # Note: You *must* invoke the superclass setup method from your own implementation.
  setup: (attributes) ->
    @set('image', attributes['image'])

  # Steps the agent forward in time by timestep seconds. This is the override point to update each agent's state at 
  # each step of the simulation.  
  #
  # Note: You *must* invoke the superclass step method from your own implementation.
  step: (timestep) ->
    @set('velocity', @get('acceleration').multiply(timestep)) if @get('acceleration')
    
    location = @get('location').add(@get('velocity').multiply(timestep))
    @set('location', location)
    
    if @parent
      @set('global_location', location.rotate(@parent.get('global_heading'), [0,0]).add(@parent.get('global_location')))
      @set('global_heading', (@parent.get('global_heading') + @get('heading')) % breve.PI2)
    else
      @set('global_location', location)
      @set('global_heading', @get('heading'))
      
  addChild: (child) ->
    ###
    Adds a child object to the simulation.
    ###
    child.parent = this
    @engine.add(child)
    
  set: (key, value) ->
    ###
    Sets the given key of the agent's state to the provided value.
    
    This method also looks for a method matching the given key in the form "set[Keyname]", and invokes 
    it with the given value if it exists, allowing the agent to take other actions in response to state
    being set.  For example, "@set('image', imageURL)" also invokes the agent's "setImage" method to 
    load an image from a URL.
    ###
    setter = "set" + key[0].toUpperCase() + key.slice(1);

    if this[setter]
      this[setter](value)

    @state[key] = value

  get: (key) ->
    ### Returns the agent's state value for the provided key. ###
    @state[key]
    
  setImage: (imageURL) =>
    ### Sets and loads the agent's image URL. ###
    
    if imageURL
      @image = new Image()
      @image.src = imageURL
    else
      @image = null

  distanceTo: (agent) ->
    ###
    Returns the distance to another breve.Agent.
    ###
    
    @get('global_location').distanceFrom(agent.get('global_location'))
    
  angleTo: (agent) ->
    ###
    Returns the angle from this agent to another breve.Agent.  Takes this agent's heading into account, 
    but not the target agent's heading.
    ###

    (agent.get('global_location').subtract(@get('global_location'))
      .angleFrom(breve.vector([1,0]).rotate(@get('global_heading'), breve.vector([0,0])))) % breve.PI2
    
  draw: (canvasContext) =>
    ###
    Draws the agent with the given HTML5 Canvas Context.  You may override this method to perform your 
    own drawing methods if desired.  By the time this method is invoked, the context has already been 
    translated and rotated to match the agent's current position, so your drawing should be centered 
    around the point (0,0).
    ###
    if @image 
      dim = Math.max(@image.width, @image.height)
      factor = 2.0 / dim
      canvasContext.scale(factor, factor)
      canvasContext.drawImage(@image, -@image.width/2, -@image.height/2)
    else
      canvasContext.fillStyle = @_fillStyle()
      canvasContext.beginPath();
      canvasContext.arc(0,0,1.0,0,Math.PI*2,true);
      canvasContext.fill()    

  _fillStyle: ->
    color = @get('color')
    @fillStyle_ ||= "rgba(" + Math.floor(255 * color[0]) + "," + Math.floor(255 * color[1]) + "," + Math.floor(255 * color[2]) + "," + color[3] + ")"

  _render: (ctx) =>
    ctx.save()
    ctx.translate(@state['global_location'].elements[0], @state['global_location'].elements[1])
    ctx.rotate(@state['global_heading'])
    ctx.scale(@state['radius'], @state['radius'])
    @draw(ctx)
    ctx.restore() 
  