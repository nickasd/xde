function loadMeals(meals) {
	console.assert(meals, 'No meals defined');
	var container = $('#meals');
	container.empty();
	for (var i = 0; i < meals.length; i += 1) {
		var meal = meals[i];
		console.log(meal.name);
		container.append(`<div class="meal"><p>${meal.name} <a href="#">Hide</a></p><img src="images/${meal.image}" /></div>`);
	}
	
	$('.meal a').on('click', (event) => {
		var target = $(event.target);
		target.text(target.text() == 'Hide' ? 'Show' : 'Hide');
		target.closest('.meal').find('img').toggle();
	});
}

class Meal {
	constructor() {

	}
	setImage(image) {
		
	}
	setTitle(title) {
		
	}
}