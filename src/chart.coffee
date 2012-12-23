class breve.Chart
  constructor: (@engine, @chartSelector) ->
    return unless window.nv && window.d3 && window.$

    @chart = nv.models.lineChart()
    @chart.xAxis.axisLabel('Simulation Time (seconds)').tickFormat(d3.format('.02f'));
    @chart.yAxis.axisLabel('Value').tickFormat(d3.format('.04f'));
    
    nv.addGraph(@chart)
  
  update: (data) ->
    d3.select(@chartSelector).datum(@buildData(data)).call(@chart)
    nv.utils.windowResize(chart.update);
  
  stop: ->
    $(@chartSelector).empty()
  
  buildData: (data) ->
    _.map(_.keys(data), (key) =>
      d = data[key]
      {values: d.values, key: d.label || key, color: d.color || '#ff0000'}
    )