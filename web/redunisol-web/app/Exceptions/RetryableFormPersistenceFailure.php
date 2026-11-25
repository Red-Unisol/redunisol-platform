<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Falla de la carga del formulario en la que es seguro que el lead no se creo en Bitrix24,
 * y por eso se puede reintentar sin duplicarlo.
 */
class RetryableFormPersistenceFailure extends RuntimeException {}
