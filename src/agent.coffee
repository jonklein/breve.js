class breve.Agent
  constructor: (@engine, attrs) ->
    @state = {}
    @set('heading', attrs['heading'] || 0)
    @set('location', breve.vector(attrs['location'] || [0,0]))
    @set('velocity', breve.vector(attrs['velocity'] || [0,0]))
    @set('color', [1,1,1,1])

    @setup(attrs)

  setup: (attrs) ->
    @set('image', attrs['image'])

  step: (step) ->
    location = @get('location').add(@get('velocity').multiply(step))
    @set('location', location)
    
    if @parent
      @set('global_location', location.rotate(@parent.get('heading'), [0,0]).add(@parent.get('location')))
      @set('global_heading', @parent.get('heading') + @get('heading'))
    else
      @set('global_location', location)
      @set('global_heading', @get('heading'))
      
  addChild: (child) ->
    child.parent = this
    @engine.add(child)
    
  set: (k,v) ->
    @state[k] = v
    
    setter = "set" + k[0].toUpperCase() + k.slice(1);
    if this[setter]
      this[setter](v)

  get: (k) ->
    @state[k]
    
  setImage: (i) =>
    if i
      @image = new Image()
      @image.src = i
    else
      @image = null
    
  fillStyle: ->
    color = @get('color')
    @fillStyle_ ||= "rgba(" + Math.floor(255 * color[0]) + "," + Math.floor(255 * color[1]) + "," + Math.floor(255 * color[2]) + "," + color[3] + ")"
  
  draw: (ctx) =>
    if @image 
      dim = Math.max(@image.width, @image.height)
      factor = 2.0 / dim
      ctx.scale(factor, factor)
      ctx.drawImage(@image, -@image.width/2, -@image.height/2)
    else
      ctx.fillStyle = @fillStyle()
      ctx.beginPath();
      ctx.arc(0,0,1.0,0,Math.PI*2,true);
      ctx.fill()    
  
  render: (ctx) =>
    ctx.save()
    ctx.translate(@state['global_location'].elements[0], @state['global_location'].elements[1])
    ctx.rotate(@state['global_heading'])
    ctx.scale(@state['radius'], @state['radius'])
    @draw(ctx)
    ctx.restore() 
  