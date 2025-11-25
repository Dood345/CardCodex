package com.independent.cardcodex.feature_pokedex

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.independent.cardcodex.core_database.SpeciesEntity
import com.independent.cardcodex.data.ImportProgress

@Composable
fun PokedexScreen(
    onSpeciesClick: (Int) -> Unit,
    viewModel: PokedexViewModel = hiltViewModel()
) {
    val speciesList by viewModel.allSpecies.collectAsState()
    val importProgress by viewModel.importProgress.collectAsState()
    var showImportDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Card Codex") },
                actions = {
                    IconButton(onClick = { showImportDialog = true }) {
                        Text("Import")
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            if (importProgress !is ImportProgress.Idle && importProgress !is ImportProgress.Completed) {
                ImportStatus(importProgress)
            }

            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 100.dp),
                contentPadding = PaddingValues(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(speciesList) { species ->
                    SpeciesItem(species, onClick = { onSpeciesClick(species.id) })
                }
            }
        }
    }

    if (showImportDialog) {
        ImportDialog(
            onDismiss = { showImportDialog = false },
            onImport = { url ->
                viewModel.startImport(url)
                showImportDialog = false
            }
        )
    }
}

@Composable
fun ImportStatus(progress: ImportProgress) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            CircularProgressIndicator(modifier = Modifier.size(24.dp))
            Spacer(modifier = Modifier.width(16.dp))
            Text(
                text = when (progress) {
                    is ImportProgress.Starting -> "Starting import..."
                    is ImportProgress.FetchingSpecies -> "Fetching species..."
                    is ImportProgress.FetchingCards -> "Fetching cards: Set ${progress.current}/${progress.total}"
                    is ImportProgress.Error -> "Error: ${progress.message}"
                    else -> ""
                }
            )
        }
    }
}

@Composable
fun SpeciesItem(species: SpeciesEntity, onClick: () -> Unit) {
    val typeColor = getTypeColor(species.types.firstOrNull())
    
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .clickable(onClick = onClick),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            AsyncImage(
                model = species.iconUrl,
                contentDescription = species.name,
                modifier = Modifier.size(80.dp),
                contentScale = ContentScale.Fit,
                error = remember {
                    // Placeholder logic handled by fallback composable if needed, 
                    // but AsyncImage 'error' param expects a painter.
                    // We'll overlay the text avatar if image fails to load or is null.
                    null 
                }
            )
            
            // Text Avatar Fallback (Simplified: Always show name at bottom)
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .background(typeColor.copy(alpha = 0.8f))
                    .padding(4.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = species.name,
                    color = Color.White,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1
                )
            }
            
            // If we wanted a true fallback for the image itself, we'd need a custom layout or state handling.
            // For now, let's assume the iconUrl works or we just see the name.
        }
    }
}

@Composable
fun ImportDialog(onDismiss: () -> Unit, onImport: (String) -> Unit) {
    var url by remember { mutableStateOf("https://raw.githubusercontent.com/Dood345/CardCodex/main/manifest.json") } // Default for testing

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Import Manifest") },
        text = {
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                label = { Text("Manifest URL") }
            )
        },
        confirmButton = {
            Button(onClick = { onImport(url) }) {
                Text("Import")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

fun getTypeColor(type: String?): Color {
    return when (type?.lowercase()) {
        "fire" -> Color(0xFFEE8130)
        "water" -> Color(0xFF6390F0)
        "grass" -> Color(0xFF7AC74C)
        "electric" -> Color(0xFFF7D02C)
        "psychic" -> Color(0xFFF95587)
        "ice" -> Color(0xFF96D9D6)
        "dragon" -> Color(0xFF6F35FC)
        "dark" -> Color(0xFF705746)
        "fairy" -> Color(0xFFD685AD)
        "normal" -> Color(0xFFA8A77A)
        "fighting" -> Color(0xFFC22E28)
        "flying" -> Color(0xFFA98FF3)
        "poison" -> Color(0xFFA33EA1)
        "ground" -> Color(0xFFE2BF65)
        "rock" -> Color(0xFFB6A136)
        "bug" -> Color(0xFFA6B91A)
        "ghost" -> Color(0xFF735797)
        "steel" -> Color(0xFFB7B7CE)
        else -> Color.Gray
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TopAppBar(title: @Composable () -> Unit, actions: @Composable RowScope.() -> Unit = {}) {
    CenterAlignedTopAppBar(
        title = title,
        actions = actions,
        colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
        )
    )
}
