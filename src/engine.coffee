class breve.Engine
  constructor: (@opts) ->
    @opts ||= {}
    @simulationTime = 0.0
    @frameCount = 0
    @objects = []
    @canvas = document.getElementById(@opts.canvas)
    @canvas.addEventListener('click', @clickEvent) if @canvas
    @timeStep = @opts['stepsize'] || 0.1
    @opts.engine ||= {}

    @configure()
    
  clickEvent: (ev) =>
    @click(breve.vector([ev.clientX, ev.clientY]), null, ev)
    
  click: (location, target, event) ->
    
  configure: ->
    if @opts.engine['background']
      @image = new Image()
      @image.src = @opts.engine['background']

    _.each(@opts.agents, (agent) =>
      @objects = @objects.concat(_.map([1..agent.count], => 
        new (eval(agent.type))(@, agent.attributes || {})
      ))
    )
        
  add: (agent) =>
    @objects.push(agent)
    agent
    
  all: (o) =>
    _.select(@objects, (i) ->
      i.prototype == o
    )
      
  start: () =>
    @i = setInterval(@step, 1000 * (1.0/60.0))
    
  stop: =>
    @objects = []
    clearInterval(@i)

  step: => 
    @simulationTime += @timeStep
    @mapMethod(@objects, "step", [@timeStep])
    
    ctx = @canvas.getContext('2d')
    ctx.clearRect(0, 0, @canvas.width, @canvas.height)
    @render(ctx)
    @mapMethod(@objects, "render", [ctx])
    @trackFPS()
    @updatePage()
    
  trackFPS: ->
    frameInterval = 100
    @frameCount += 1
    
    if (@frameCount % frameInterval) == 1
      @fps = if @lastCheck then (frameInterval / (((new Date()).getTime() - @lastCheck)/1000.0)) else 0.0
      @lastCheck = (new Date()).getTime()
      
  updatePage: ->
    $('.time-index').text(@simulationTimeString())
    $('.fps').text(@truncateValue(@fps))
    
  simulationTimeString: ->
    seconds = new String(Math.floor((@simulationTime * 10) % 600) / 10.0)
    minutes = new String(Math.floor(@simulationTime / 60))
    
    seconds = "0" + seconds if seconds < 10
    minutes + ":" + seconds 
      
  render: (ctx) =>
    if @image 
      ctx.drawImage(@image, 0, 0)
    else
      lingrad = ctx.createLinearGradient(0,0,0,150);
      lingrad.addColorStop(0, '#00ABEB');
      lingrad.addColorStop(1, '#88DBFB');

      ctx.fillStyle = lingrad;
      ctx.fillRect(0, 0, @canvas.width, @canvas.height)
        
  truncateValue: (value, count) ->
    factor = Math.pow(10, count || 2)
    Math.floor(value*factor)/factor
  
  mapMethod: (list, name, args) -> 
    _.map(list, (i) ->
      args = [] if !args
      i[name].apply(i, args)
    )