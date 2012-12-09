class Mask.Agent
  # engine: null,
  # 
  # state:
  #   image: null,
  #   heading: 0
  # 
  # location: [0,0],
  # velocity: [.8,.3],
  # color: [1,1,1,1],
  # radius: 6,
  # imageInst: null,
  
  constructor: (@engine, attrs) ->
    @state = {}
    @set('location', Mask.vector(attrs['location'] || [0,0]))
    @set('heading', attrs['heading'] || 0)
    @set('velocity', Mask.vector(attrs['velocity'] || [0,0]))
    @set('color', [1,1,1,1])
    
    @setup(attrs)

  setup: (attrs) ->
    @setImage(attrs['image'])


  step: (step) ->
    @set('location', @get('location').add(@get('velocity').multiply(step)))
    
  set: (k,v) ->
    @state[k] = v

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
      ctx.rotate(@state['heading'])
      ctx.drawImage(@image, -dim/2, -dim/2)
    else
      ctx.fillStyle = @fillStyle()
      ctx.beginPath();
      ctx.arc(0,0,1.0,0,Math.PI*2,true);
      ctx.fill()    
  
  render: (ctx) =>
    ctx.save()
    ctx.translate(@state['location'].elements[0], @state['location'].elements[1])
    ctx.scale(@state['radius'], @state['radius'])
    @draw(ctx)
    ctx.restore() 
  