# Набор Исправлений и Улучшений Сайта cellmapper.net
@ru_fieldtest September 09, 2021

Изначально патч задуман и написан для исправления единственной проблемы: при перемещении площадки (точки на карте) новое положение часто не сохраняется.

Немного подробнее. После изменения положения на карте сервер подтверждает новую позицию, в истории появляется строка о перемещении, выводится всплывающее сообщение. Однако, через короткое время (от нескольких секунд до нескольких минут) координаты сбрасываются на предыдущие/изначальные. В редких случаях новая позиция всё-таки появляется в базе/на карте спустя часы или даже дни, но, по моей грубой прикидке, такое случается в одном случае из нескольких десятков.

Проблема, как очевидно, на стороне сервера. В тоже время несложная логика позволяет в большинстве случаев добиться надёжного сохранения либо, как минимум, сообщить о невозможности сохранения.

Беглый поиск по истории разных площадок показывает, что проблема существует давно и стабильно появляется у многих пользователей.

Ниже список ошибок, которые были исправлены заодно с вышеописанной проблемой. Инструкция как пользоваться User JS / User CSS в самом низу страницы.


Ошибки:

✔ Клик вне зоны покрытия оставляет точку выбранной/перемещаемой

✔ В некоторых условия невозможно выбрать другую точку

✔ Перемещение площадки по координатам не перемещает точку на карте

✔ После удаления площадки с карты удаляется все точки с этим site id (2G/3G)

✔ Невозможно выбрать подряд две точки с одним site id (2G/3G)

✔ Не применяется оформление выбранного сектора

✔ Выбор сектора на карте не прокручивает детали до описания этого сектора

✔ Списки на первой закладке (сеть, тип сети, диапазон) прокручиваются слишком быстро

❌ Настройки отображения (показывать покрытие, коды площадок и т.д.) работают криво

❌ Ссылки в истории изменений не ведут на предыдущие позиции


Улучшения:

HiDPI карты и метки площадок

Отдельный цвет для меток неподтверждённых площадок

Добавлен код местности (LAC) после кода площадки (2G/3G)

Настроены вручную цвета для несущих МФ 4G + механизм переопределения любых других

Добавлены номера секторов на карте (с пометка "+NR", при наличии флага ENDC)

Рисуются сектора только выбранного диапазона (Band)

После перемещения площадки область покрытия секторов рисуется заново (если сервер успевает пересчитать)

В "контекстное" меню добавлены ссылки на Карты и Панорамы Яндекса

Панель закладок (General / Details) зафиксирована для удобства

Список сетей сортируется по коду сети и использует общепринятое форматирование (000 00)

Убрано бесполезное поле поиска из списка сетей и типов сети

Убраны бесполезные справочные поля из деталей по площадке

Убраны переносы строк во многих списках

Добавлены подложки Яндекс.Карты, Гугл и их гибрид

Добавлено отображение kml-файлов (drag'n'drop в левую панель)

Выключены анимации и некоторый функционал карты для улучшения быстродействия

Украшательства:

Оптимизированы отступы

Добавлены тени на карту

Выключен перенос текста в поле с адресом

Выключен перенос текста в блоке настроек
