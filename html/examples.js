examples = [
  {
    name: 'Bounce',
    description: 'A simple simulation showing basic physics rules applied to simple agents',
    source: 'src/examples/ball.coffee',
    configuration: {
      "agents": [ {"type": "breve.Examples.Ball", "count": 5, "attributes": {"image": "html/images/ball.png"} } ]
    }
  },
    
  {
    name: 'Braitenberg',
    description: 'A Braitenberg vehicle simulation.',
    source: 'src/examples/braitenberg.coffee',
    configuration: {
      engine: {
        background: "html/images/road.jpg"
      },
      agents: [ 
        { type: "breve.Examples.BraitenbergVehicle", count: 1 },
        { type: "breve.Examples.BraitenbergLight", "count": 1, attributes: {"location": [400,400]} } 
      ]
    }
  } 
];

function stop() {
  breve.stop();
}

function start() {
  var config;
  try {
    err = CoffeeScript.run($("#code").val());
    config = JSON.parse($('#configuration').val())
  } catch(err) {
    alert("An error occurred parsing the configuration: " + err);
  }
  breve.start($.extend(config, {canvas: 'breve-canvas'}));        
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
