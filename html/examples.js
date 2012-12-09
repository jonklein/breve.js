examples = [
  {
    name: 'Bounce',
    description: 'A simple simulation showing basic physics rules applied to simple agents',
    source: '../src/examples/ball.coffee',
    configuration: {
      "agents": [ {"type": "Mask.Examples.Ball", "count": 5, "attributes": {"image": "images/ball.png"} } ]
    }
  },
    
  {
    name: 'Braitenberg',
    description: 'A Braitenberg vehicle simulation.',
    source: '../src/examples/braitenberg.coffee',
    configuration: {
      engine: {
        background: "images/road.jpg"
      },
      agents: [ 
        {type: "Mask.Examples.BraitenbergVehicle", count: 1, attributes: {"image": "http://community.roll20.net/uploads/thumbnails/FileUpload/32/7abd6ab2e9bf92ae2a397db0db3b1c.png"} },
        {type: "Mask.Examples.BraitenbergLight", "count": 1, attributes: {"location": [400,400]} } 
      ]
    }
  } 
];

function stop() {
  Mask.stop();
}

function start() {
  var config;
  try {
    err = CoffeeScript.run($("#code").val());
    config = JSON.parse($('#configuration').val())
  } catch(err) {
    alert("An error occurred parsing the configuration: " + err);
  }
  Mask.start($.extend(config, {canvas: 'mask-canvas'}));        
}

function select() {
  var name = $('select.simulation-select').val();
  var example = _.find(examples, function(f) { return f.name == name; });
  
  $.ajax({url: example.source + "?" + new Date().getTime(), success: function(data) { 
    $("#code").val(data); 
    start();
  }});

  
  $(".description").html(example.description); 
  $('#configuration').val(JSON.stringify(example.configuration, null, 2));
}
      
$(function() {
  $('select.simulation-select').empty();
  _.each(examples, function (f) {
    $('select.simulation-select').append($("<option/>").text(f.name));
    $('select.simulation-select').change(select);
  });
  
  $('select.simulation-select').change();
})