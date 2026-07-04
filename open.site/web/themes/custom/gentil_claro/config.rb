##
## This file is only needed for Compass/Sass integration. If you are not using
## Compass, you may safely ignore or delete this file.
##
## If you'd like to learn more about Sass and Compass, see the sass/README.txt
## file for more information.
##

# Environment
environment = :production
#environment = :development

# Location of the theme's resources.
css_dir = "css"
sass_dir = "sass"
images_dir = "img"
generated_images_dir = images_dir
javascripts_dir = "js"

##
## You probably don't need to edit anything below this.
##

# You can select your preferred output style here (:expanded, :nested, :compact
# or :compressed).
output_style = (environment == :production) ? :compressed : :expanded

# To enable relative paths to assets via compass helper functions. Since Drupal
# themes can be installed in multiple locations, we don't need to worry about
# the absolute path to the theme from the server omega.
relative_assets = true

# Output source maps in development mode.
sass_options = (environment == :development) ? {:sourcemap => true} : {}
