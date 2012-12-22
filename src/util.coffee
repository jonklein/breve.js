class breve.Util 
  @truncateValue: (value, count) ->
    factor = Math.pow(10, count || 2)
    Math.floor(value*factor)/factor

  @mapMethod: (list, name, args) -> 
    _.map(list, (i) ->
      args = [] if !args
      i[name].apply(i, args)
    )
    
  @timeString: (timeIndex) ->
    seconds = new String(Math.floor((timeIndex * 10) % 600) / 10.0)
    minutes = new String(Math.floor(timeIndex / 60))
    
    seconds = "0" + seconds if seconds < 10
    minutes + ":" + seconds 
    