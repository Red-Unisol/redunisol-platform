export default function TestPage() {
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        try {
            const response = await fetch('/api/pdf/search', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                },
                body: new FormData(form),
            });
            
            const data = await response.json();
            
            if (response.ok) {
                console.log('Resultado:', data);
                alert(`Patrón encontrado: ${data.found ? 'Sí' : 'No'}`);
            } else {
                console.error('Error del servidor:', data);
                alert(`Error: ${data.message || 'Error desconocido'}`);
            }
        } catch (error) {
            console.error('Error de red:', error);
        }
    };

    return (
        <div>
            <form onSubmit={handleSubmit}>
                <input type="file" name="file" required accept="application/pdf" />
                <button className='btn btn-primary'>
                    Send
                </button>
            </form>
        </div>
    );
}