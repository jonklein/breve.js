###
The main breve simulation Engine which manages the simulation state.
###
class breve.Engine
  # @private
  constructor: (@opts) ->
    @opts ||= {}
    @simulationTime = 0.0
    @frameCount = 0
    @objects = []
    @canvas = document.getElementById(@opts.canvas) if @opts.canvas
    @canvas.addEventListener('click', @_clickEvent) if @canvas
    @timeStep = @opts['stepsize'] || 0.1
    @opts.engine ||= {}
    @collider = new breve.CollisionDetector()
    
    @datapoints = {}
    
    if @opts.chart
      @charter = new breve.Chart(@, @opts.chart.selector) 
      @chartfields = @opts.chart.fields
      
      _.each(_.keys(@opts.chart.fields), (field) =>
        @opts.chart.fields[field].values = []
        @opts.chart.fields[field].color ||= '#ff0000'
      )
      
    @_configure()
    
  # Invoked on the engine when a click occurs in the rendered simulation area.
  #
  # @param location the x, y vector location of the click
  # @param target the simulation agent that was clicked on, or null if no object was clicked
  # @param event the DOM event which initiated the click
  click: (location, target, event) ->
  
  # Sets up the simulation with a set of provided attributes. This is the override point to configure 
  # the initial state of the simulation based on the simulation options.
  #
  # Note: You *must* invoke the superclass setup method from your own implementation.
  setup: ->


  # Adds an agent to the simulation.
  # 
  # @param agent the agent to add.  Must be breve.Agent or one of its subclasses.
  # @return [breve.Agent] the agent that was added to the simulation
  add: (agent) ->
    @objects.push(agent)
    agent
  
  # Returns an array of all agents in the simulation matching the given type.
  #
  # @param agentType the agent class to search for in the simulation
  # @return [Array] all agents of the given agentType
  all: (agentType) ->
    _.select(@objects, (i) -> i.__proto__.constructor == agentType)
    
  # Starts the simulation, scheduling a timer to step the simulation forward in time 60 
  # times per second until stop is called.
  start: () ->
    @i = setInterval(() => 
      @step()
    , 1000 * (1.0/60.0))
  
  # Stops the simulation and clears all objects.
  stop: ->
    @objects = []
    clearInterval(@i)
    @charter.stop() if @charter
  
  # Gives the bounding box of the simulation rendering area.  Simulated agents are allowed to 
  # move outside of the simulation bounds, but it is generally most useful for agents to remain
  # inside of the bounds for visualization purposes.
  #
  # @return [Object] the bounds of the simulation rendering area.
  bounds: ->
    {left: -@canvas.width/2, right: @canvas.width/2, top: @canvas.height/2, bottom: -@canvas.height/2}

  # Returns the neighbors for the given agent, inside of the provided radius.
  #
  # @param agent [breve.Agent] the agent to find neighbors for
  # @param radius [Number] the radius in which to search for neighbors
  neighbors: (agent, radius) ->
    @collider.neighbors(agent, @objects, radius)
    
  # Add a datapoint to the simulation data results.
  datapoint: (eventName, value, options = {}) ->
    @datapoints[eventName] ||= []
    @datapoints[eventName].push([@simulationTime, value])

  # Charts an value in the simulation, updating the chart with the provided frequency.
  #
  # @param eventName (String) the name of the value to add a data point for
  # @param value (Number) the value to add to the chart
  # @param frequency (Number) the number of frames between each rendering of the chart.
  #        Rendering the chart too frequently will result in poor simulation performance.
  chart: (eventName, value, frequency = 20) ->
    if @chartfields[eventName] && (@frameCount % frequency == 1)
      values = @chartfields[eventName].values

      last = values[values.length - 1]
      
      if !last || last.x != @simulationTime
        @chartDataUpdated = true
        values.push({x: @simulationTime, y: value})
        values.shift() if values.length > 500

  # Steps the simulation forward in time by the timeStep value.  This method may be overriden to 
  # execute custom simulation behaviors at each timestep.
  # 
  # Note: You *must* invoke the superclass step method from your own implementation.
  step: -> 
    @collider.detect(@objects, @simulationTime)
    
    @frameCount += 1
    @simulationTime += @timeStep
    
    try
      breve.Util.mapMethod(@objects, "step", [@timeStep])
    catch err
      @debug("An error occurred while iterating: " + err)
    
    ctx = @canvas.getContext('2d')
    ctx.clearRect(0, 0, @canvas.width, @canvas.height)
    ctx.save()
    ctx.translate(-@bounds().left, -@bounds().bottom)
    ctx.scale(1.0, -1.0)

    @draw(ctx)
    
    try
      breve.Util.mapMethod(@objects, "_render", [ctx])
    catch err
      @debug("An error occurred while rendering: " + err)
      
    ctx.restore()
      
    @_trackFPS()
    @_updatePage()
    @_updateChartData()

  # Sets a debug message to be displayed on the simulation page.
  debug: (msg) ->
    $('.console').text(msg)

  # Draws the background of the simulation. 
  #
  # @param canvasContext the HTML5 Canvas context to draw on to
  draw: (canvasContext) ->
    if @image 
      canvasContext.drawImage(@image, -@canvas.width/2, -@canvas.width/2)
    else
      lingrad = canvasContext.createLinearGradient(0,0,0,150);
      lingrad.addColorStop(0, '#00ABEB');
      lingrad.addColorStop(1, '#88DBFB');

      canvasContext.fillStyle = lingrad;
      canvasContext.fillRect(-@canvas.width/2, -@canvas.width/2, @canvas.width, @canvas.height)

  # Returns the fully qualified URL for the provided relative URL according to the configuration
  # of the resourceBaseURL option.
  resourceURL: (url) ->
    if (!url || url.match(/:\/\//)) then url else (@opts.resourceBaseURL + url)

  # @private
  _configure: ->
    @opts.resourceBaseURL ||= ''
    
    if @opts.engine['background']
      @image = new Image()
      @image.src = @resourceURL(@opts.engine['background'])

    _.each(@opts.agents, (agent) =>
      @objects = @objects.concat(_.map([1..agent.count], => new (eval(agent.type))(@, agent.attributes || {})))
    )

    @setup(@opts)

  # @private
  _updateChartData: ->
    @charter.update(@chartfields) if @charter && @chartDataUpdated
    @chartDataUpdated = false

  # @private
  _clickEvent: (ev) =>
    @click(breve.vector([ev.clientX, ev.clientY]), null, ev)

  # @private
  _trackFPS: ->
    frameInterval = 100

    if (@frameCount % frameInterval) == 1
      @fps = if @lastCheck then (frameInterval / (((new Date()).getTime() - @lastCheck)/1000.0)) else 0.0
      @lastCheck = (new Date()).getTime()
  
  # @private
  _updatePage: ->
    $('.time-index').text(breve.Util.timeString(@simulationTime))
    $('.fps').text(breve.Util.truncateValue(@fps))
