//console.log('<span><<<>>>', 1, 2, true, [1, 2, 'asd6', {a: 'a', b: 'b', c: 'c'}]);


setTimeout(function () {
	//console.log(2);
}, 100);


setTimeout(() => {
	return;
	var el = document.getElementById('p');
	el.setAttribute('id', 456);
	el.parentNode.removeChild(el.parentElement.childNodes[0]);
	el.parentNode.removeChild(el.parentElement.childNodes[3]);
	el.parentNode.removeChild(el.parentElement.childNodes[0]);
	el = document.getElementById('p2');
	el.textContent = '';
	el.appendChild(document.createElement('a'));
	var a = document.createElement('a');
	el.appendChild(a);
	var i = document.createElement('i');
	i.textContent = 'trtrtrtr';
	el.parentNode.replaceChild(i, el);
}, 3000);