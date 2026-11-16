<?php

namespace App\Http\Controllers;

use App\Services\PublishedPadronesReader;
use Illuminate\Http\Request;
use PDOException;

class PadronesServiceController extends Controller
{
    public function __invoke(Request $request, PublishedPadronesReader $reader)
    {
        $data = $request->validate(['document' => 'required|string|max:30']);
        try {
            return response()->json($reader->lookup($data['document']));
        } catch (PDOException) {
            abort(503, 'No se pudieron consultar los padrones.');
        }
    }
}
